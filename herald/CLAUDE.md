# CLAUDE.md

A Paseo plugin that adds a **Herald** sidebar surface: every agent waiting on the user, each with a
one-sentence summary written by a short-lived helper agent, and speaks that sentence on the device
running the app when the event happens.

The repo root `CLAUDE.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `herald`.

## Orientation

| File                         | What it owns                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `index.server.ts`            | Wiring — three RPCs, the speech settings document, the hooks, the store's file.        |
| `index.client.tsx`           | Wiring — starts the announcer, registers the surface, sidebar item, settings screen.   |
| `shared/herald.ts`           | The `AttentionEntry` shape, the list RPC, and the daemon config document with defaults. |
| `shared/settings.ts`         | The host settings document for *how* to speak; the app reads it, the daemon never does. |
| `server/hooks.ts`            | Lifecycle events → store entries; helper recognition; turn dedupe; the summary queue.  |
| `server/summarize.ts`        | One helper agent per summary: prompt, structured output, cleanup on failure.           |
| `server/store.ts`            | One entry per agent, mirrored to `attention.json`.                                     |
| `server/timeline.ts`         | Pure text: what an agent said, what a permission asks, the no-model fallback sentence. |
| `server/config.ts`           | `$PASEO_HOME/plugins/herald/config.json`, read on every event.                          |
| `server/say.ts`              | `say` on the daemon Mac, driven for its voices: text in on stdin, a WAV out, bytes back. |
| `client/announcer.ts`        | The poll-and-speak loop that runs while the app is open, panel or no panel.            |
| `client/herald.tsx`          | The surface: Paseo's attention list joined with Herald's entries.                      |
| `client/settings-screen.tsx` | Settings › Plugins › Herald: speech (host document) and summaries (daemon RPCs).       |
| `client/option-picker.tsx`   | A settings row opening a searchable, scrolling list, for choices too long for a select. |
| `client/web.ts`              | Every browser global: audio playback, the Web Speech API, the desktop-shell check.      |
| `server/*.test.ts`           | The tests. `npm test`.                                                                 |

## The hooks have 30 seconds and the summary does not fit

Paseo aborts a hook's signal after 30 seconds and logs an error. A summary is a full agent turn and
can take longer, so `server/hooks.ts` never awaits one: the handler writes a `pending` entry and
returns, and the summary lands later through `AttentionStore.updateSummary`. That update is keyed by
`eventId` and refused when the agent has moved on to a newer event, which is what keeps a slow helper
from overwriting a fresher entry.

`schedule` caps how many helpers run at once (two). A burst of agents finishing together queues
rather than spawning a helper per agent.

## The helper is visible and fires our own hooks

The SDK's create-agent request has no `internal` flag, so the summariser is an ordinary agent. It is
created with `parent` set to the agent it describes (so it shows in that agent's subagent track, not
as a tab) and `autoArchive: true` (so the daemon archives it after its one turn). It still triggers
`agent.created`, `agent.turn_started` and `agent.turn_ended` on this plugin.

Two things identify it, and `isHelper` accepts either: the id `summarize` reports through
`onHelperCreated`, and the title `HELPER_TITLE`. The title matters because `agent.created` can fire
before `create()` resolves, and because the id set is lost on a plugin reload while a helper from
the old process may still be finishing. **Do not rename the title without checking both sides.**

`autoArchive` fires only on a finished turn. A helper that timed out or asked for a permission is
archived by hand in `summarize`, otherwise it sits in the subagent track forever.

**`outputSchema` is a request, not a guarantee.** Against a live daemon, Claude Haiku returned the
object inside a ```` ```json ```` fence, and once under a key of its own choosing (`spoken`). The
first shipped version read that as the words "code block". `parseSummaryText` therefore strips
fences, finds the object anywhere in the text, takes `speech` or else the first string in it, and
only then falls back to the prose. Keep the prompt's closing line — the exact shape and "no code
fences" — and keep the parser defensive; do not trust one to fix the other.

## `turn_ended` can repeat

The reference says a turn id can repeat after a session reopens, and the community `top` plugin has
seen the event fire twice for one turn. `isRepeatTurn` drops a second event for the same
`agentId:turnId` inside `TURN_REPEAT_WINDOW_MS`. A completed turn with no assistant text — a
compaction, a bare tool run — is dropped too; there is nothing to say.

A turn that **fails within `INTERRUPT_GRACE_MS` of the user denying a permission with `interrupt`**
is dropped as well. Claude reports that stop as a failed turn whose message is a diagnostic
(`[ede_diagnostic] … stop_reason=tool_use`); the user caused it and does not need to hear about it. A
plain deny lets the agent carry on, so a failure after one is real and is announced.

A streamed reply reaches the `turn_ended` snapshot as several `assistant_message` items, often split
mid-sentence. `latestOutputText` joins them at the seam — nothing when one side already has
whitespace there, one space otherwise — rather than as paragraphs.

## What the store means

One entry per agent, the most recent reason it is waiting. Entries are removed when the hooks see the
agent move on: `turn_started` (the user replied), `permission_resolved` for the entry's request,
`archived`. They are *not* removed when the user merely looks at the agent — Paseo's
`requiresAttention` flag handles that, and the panel lists the union of Paseo's flagged agents and
Herald's entries, joined by agent id. Herald explains; Paseo decides who is listed.

Paseo's flag is not cleared by looking, either — only by the next message to that agent — so an idle
agent from a week ago is still "finished" to it. The panel holds Paseo-only rows to the same day-long
window the store uses and drops `closed` sessions (`isCurrent` in `client/herald.tsx`); a row with no
Herald entry says so, because the event predates the plugin watching that agent.

`attention.json` mirrors the map so a plugin reload keeps the sentences already written. A summary
still `pending` at load is marked `failed` with the fallback, because its helper died with the old
process.

## Speech happens on the client, and only on two of three platforms

Plugin client code has no audio module: not from the host's module list, not from React Native core.
What it has are two browser globals, both confined to `client/web.ts`: the audio element and the Web
Speech API. Two engines are built on them, chosen by the `engine` setting:

- **`say` (default).** The app cannot run a command, but the daemon can. `herald.speech.render` has
  the daemon Mac run `say -o … --file-format=WAVE` with the sentence on stdin, and returns the WAV as
  base64; the client plays it through `new Audio(dataUrl)`. That is how the Mac's voices — far
  better than a browser's — reach the desktop app and any browser tab, wherever they are. Rendered at
  16 kHz mono so a long sentence stays well under a megabyte on the wire. Nothing plays on the
  daemon. Not a Mac, no `say`, an unknown voice, or a refused playback: the announcer logs once and
  falls through to the browser voice.
- **`web`.** The Web Speech API, with this device's voices. The fallback, and the choice for a
  daemon that is not a Mac.

Platform rules apply to both:

- **Desktop (Electron)** plays unprompted. Electron's autoplay policy defaults to no gesture
  required and Paseo does not override it.
- **Browser tab** plays only after the page has been tapped once. Chromium and WebKit refuse both
  `play()` and `speak()` without user activation; `speak()` fires no event on refusal, which is why
  it also resolves on a guard timer — a queue waiting on `onend` would otherwise stall. The panel's
  **Test voice** button is the tap.
- **iOS / Android** cannot play either. `Vibration.vibrate()` is the most plugin code can do,
  behind a switch that is off by default. Paseo's own push notifications carry the text there.

Deliveries queue behind one another in the announcer (`chain`), so a Speak button pressed during a
poll's announcement waits rather than talking over it.

Paseo's daemon has a text-to-speech pipeline of its own (`TTSManager`, behind voice mode) that the
app plays on every platform, but nothing in the 0.8 plugin API reaches it. If mobile speech is ever
wanted, that is the upstream request.

## Two settings stores, and why

Speech settings (`shared/settings.ts`) are a host document: every client of the daemon reads the same
one, and each acts only on its own platform switch. That is how "speak on the Mac, not in the browser
on the laptop" is said without per-device storage, which the SDK does not have. "Mute here" in the
panel is module scope for the same reason — this device, until the app restarts.

The announcer reads that document outside any component through `client.rpc(settingsRpc(...).read)`,
the same contract `useSettings` is built on. **Verify this against a live app after a host upgrade**:
if the host stopped routing `settings.*` through `rpc`, the announcer logs one warning and falls back
to the values a mounted screen last mirrored, or to the defaults.

The daemon config (`shared/herald.ts`) is what the hooks act on — which events to summarise, which
model — so it is the daemon's file behind `herald.config.read` / `herald.config.write`.

## Long lists do not fit a `SettingsSelect`

The host's `SettingsSelect` popover does not scroll. It is fine for the four speeds and the two
voice sources and useless for a Mac's `say` voices — 185 of them in 51 languages on the daemon this
was built against — or a browser's voices or every provider's models. Those three use
`client/option-picker.tsx`: a `SettingsRow` whose control opens a host `Modal` with scrolling turned
off, so the host `FlatList` inside it is what scrolls, above a host `TextInput` that filters by label,
detail, or value. Keep `SettingsSelect` for anything under about ten options and reach for the picker
past that.

## The SDK's state hooks do not work in a surface

`useWorkspace` and `useAgent` throw "Plugin state hooks must run inside a workspace panel" when
called from a sidebar surface — they are for `addWorkspacePanel` components, which have a workspace
or agent in scope. The first shipped panel used one for the workspace name and failed on mount.
`client/herald.tsx` lists workspaces through the host API on each refresh and maps id to title
instead. Anything a surface needs to know about workspaces or agents goes through `usePaseo()`.

## Checking it

`npm test` covers everything that does not need a daemon: text extraction, the fallback sentences,
the store, the summariser against a fake SDK, and the hooks against a fake server. What it cannot
cover, check by hand after `paseo plugin reload herald`:

1. Ask a running agent something that makes it call AskUserQuestion, or let one finish a turn. Within
   a few seconds the panel shows the entry with "Writing the summary…", then the sentence, and the
   desktop app speaks it in the Mac's voice. `paseo plugin logs herald` shows any summary or render
   failure; a fall-through to the browser voice is a warning in the app console.
2. Open the agent from the panel; the row disappears once you reply.
3. In a browser tab, nothing is spoken until **Test voice** has been pressed once.
4. Switch a kind off in Settings › Plugins › Herald and trigger it: the row appears with "Not
   announced" and no helper is created.
