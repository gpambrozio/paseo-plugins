# AGENTS.md

A Paseo plugin that adds a **Herald** sidebar surface: every agent waiting on the user, each with a
one-sentence summary written by a short-lived helper agent, and speaks that sentence on the device
running the app when the event happens.

The repo root `AGENTS.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `herald`.

## Orientation

| File                         | What it owns                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `index.server.ts`            | Wiring — three RPCs, the speech settings document, the hooks, the store's file.        |
| `index.client.tsx`           | Wiring — the announcer, the surface, sidebar item, settings screen, its opener.         |
| `shared/herald.ts`           | The `AttentionEntry` shape, the list RPC, and the daemon config document with defaults. |
| `shared/settings.ts`         | The host settings document for *how* to speak; the app reads it, the daemon never does. |
| `shared/timeline.ts`         | The summary card's `kind`/`version` and schema; a *runtime* import on both sides.        |
| `server/card.ts`             | Appends the summary card to the agent's transcript, one chain per row.                 |
| `client/timeline-card.tsx`   | Draws that card, with a Play button that speaks the sentence again.                     |
| `server/hooks.ts`            | Lifecycle events → store entries; helper recognition; turn dedupe; the summary queue; which agents are announced. |
| `server/summarize.ts`        | One helper per summary: the prompt template, structured output, cleanup on failure.     |
| `server/cleanup.ts`          | The `paseo` CLI: deleting one helper by id, and sweeping the rest by label.             |
| `server/store.ts`            | One entry per agent, mirrored to `attention.json`.                                     |
| `server/liveness.ts`         | Asks the daemon whether each entry's agent is still open before the list goes out.     |
| `server/workspaces.ts`       | The workspace title an entry is named by, cached; agents are usually untitled.         |
| `server/timeline.ts`         | Pure text: what an agent said, what a permission asks, the no-model fallback sentence. |
| `server/config.ts`           | `$PASEO_HOME/plugin-data/herald/config.json`, read on every event.                     |
| `server/data-dir.ts`         | `$PASEO_HOME/plugin-data/herald/`, and moving the plugin's files out of `plugins/`.     |
| `server/say.ts`              | `say` on the daemon Mac, driven for its voices: text in on stdin, a WAV out, bytes back. |
| `client/announcer.ts`        | The poll-and-speak loop that runs while the app is open, panel or no panel.            |
| `client/herald.tsx`          | The surface: Paseo's attention list joined with Herald's entries.                      |
| `client/agents.ts`           | Keeps an agents observation open so Paseo's agent stream reaches the two above.         |
| `client/settings-screen.tsx` | Settings › Plugins › Herald: speech (host document) and summaries (daemon RPCs).       |
| `client/option-picker.tsx`   | A settings row opening a searchable, scrolling list, for choices too long for a select. |
| `client/prompt-editor.tsx`   | A settings row opening the summary prompt in a modal, with its placeholder legend.      |
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

## Visible also means it stays, so it is deleted

An archived agent is still a session in the user's history, and there is one per summary. The plugin
API has no hard delete — `PaseoAgentHandle` offers `archive()` and `detach()` and nothing else — so
`server/cleanup.ts` shells out to the **`paseo` CLI**, which plugin code may do because it runs
unsandboxed beside the daemon. `paseo delete <id>` interrupts the agent and removes it, which is why
`retire` in `summarize` tries the delete *instead of* the archive and falls back to archiving only
when the delete is switched off or fails.

`config.cleanup.deleteHelpers` is the switch, on by default.

Two callers, because one id is not enough:

- **`summarize` deletes the helper it just used**, by id. Precise, and it can never hit a summary
  still being written.
- **`index.server.ts` sweeps by label**, once, `SWEEP_DELAY_MS` after load — for the helpers no id
  survived for: the backlog from before any of this existed, and whatever a plugin reload or a
  stopped daemon orphaned mid-summary. The delay is not cosmetic: this plugin is loaded *by* the
  daemon and the CLI has to connect *to* it, so a sweep that ran at contribution time would meet a
  daemon that is not listening yet and give up for the life of the process.

Three things about the sweep are load-bearing:

- **`paseo ls` pages** — twenty agents at a time — so one pass is not the backlog. `sweepHelpers`
  asks again until a page holds nothing it may delete, and gives up after `MAX_SWEEP_PASSES` rather
  than trusting the daemon to run out. A pass that deleted *nothing* also ends it, or a page of ids
  that all refuse to delete would be re-read to the limit. Listing is the half that could leave the
  CLI — `paseo.agents.list` takes a `labels` filter and `includeArchived`, two hundred to a page —
  but the sweep runs from the server entry, whose `PluginServerContext` carries no `paseo`, and
  the delete needs the CLI whatever lists the ids.
- **`keep` is the hooks' helper set**, handed in from `index.server.ts` as `liveHelpers`, so the
  sweep cannot delete a helper mid-sentence. That is the one thing the equivalent shell loop
  (`paseo ls --label herald.role=summarizer -q | xargs -n1 paseo delete`) gets wrong.
- **`-q` prints short ids, `--json` prints full ones.** The sweep reads `--json`; `paseo delete`
  accepts either, but a prefix is a prefix.

A **deleted** agent fires no `agent.archived`, which is what used to drop its id from the hooks'
`helpers` set. `rememberHelper` therefore caps that set the way `resolvedRequests` is capped —
oldest out first, and a helper still writing is always the newest. Do *not* "fix" the growth by
forgetting the id when the summary settles: the id is how a helper whose title the hook never saw is
recognised, and `server/hooks.test.ts` proves it.

The CLI is found once per process by walking `PATH` and then `~/.local/bin`, `/usr/local/bin` and
`/opt/homebrew/bin`. Not finding it is not fatal — it throws, the sweep logs once and the per-helper
deletes log per helper, and everything else about the plugin carries on.

To check it against a live daemon rather than fakes, write a throwaway `*.tmp.test.ts` calling
`listHelperIds` and `sweepHelpers` against the real `~/.paseo`, read what it prints, then delete it.

## The prompt is a template the user owns

`config.summarizer.prompt` holds it; `DEFAULT_SUMMARY_PROMPT` in `shared/herald.ts` is what ships and
what *Restore the default* writes back. `renderPrompt` substitutes the names in `PROMPT_PLACEHOLDERS`
and nothing else, under two rules the settings screen states in the same words:

- **A line whose placeholder is empty for this event is dropped whole**, and the blank lines that
  leaves are collapsed. That is what replaced the old `if (detail !== null) lines.push(...)`: a
  template has no conditionals, so `Detail: {{detail}}` has to disappear on its own. It is also why
  the default keeps each label on one line with its value, `What the agent said: {{output}}`, rather
  than the label on a line of its own — that one would survive with nothing under it.
- **An unknown `{{name}}` is left exactly as typed.** A typo reaches the model verbatim instead of
  silently becoming an empty line.

Blank is not empty: `buildPrompt` reads a blank template as the default, and the editor saves `""`
when the draft matches the default, so a user who never customised it follows the default as it
changes rather than freezing a copy of today's.

**The closing JSON line is now the user's to delete**, which is a change from what the next paragraph
used to promise. Deleting it is survivable only because `parseSummaryText` falls back to the prose;
the editor warns when the word `speech` has left the prompt, and the default still asks for the
object. Keep both halves working — do not lean on the prompt now that it is editable.

**`outputSchema` is a request, not a guarantee.** Against a live daemon, Claude Haiku returned the
object inside a ```` ```json ```` fence, and once under a key of its own choosing (`spoken`). The
first shipped version read that as the words "code block". `parseSummaryText` therefore strips
fences, finds the object anywhere in the text, takes `speech` or else the first string in it, and
only then falls back to the prose. Keep the *default* prompt's closing line — the exact shape and "no
code fences" — and keep the parser defensive; do not trust one to fix the other.

## Agents another agent started are their parent's to announce

When an agent starts another through Paseo's tools, Paseo records the starter as its parent — the
`paseo.parent-agent-id` label, which reaches a hook as `PluginHookAgent.parentAgentId` — and, with
`notifyOnFinish` (on by default for agent-scoped calls), sends the parent a note when the child
finishes, errors or asks for a permission. The parent then acts and ends its own turn, which Herald
announces. Announcing the child as well says everything twice, and the child's sentence is the worse
one: it knows only its own task. A FirstMate crew is the case that raised it — the first mate's
report is what the user wants to hear.

So `isAnnounced` treats a child like a switched-off kind unless `config.subagents.announce` is on:
listed in the panel with the fallback, no helper, no transcript card, nothing spoken. Off by default.
Nothing about FirstMate is known here — no label, no agent id — so it covers any orchestrator, and
costs no lookup, because the parent id arrives with every event.

Paseo takes the parent label off a cross-workspace child when the parent is archived (a FirstMate
worker, once its first mate is released or relaunched), so from then on the child is announced like
any other agent: there is nobody left to speak for it. A legacy `detached` creation never had a parent
and is announced throughout. Herald's own helpers have a parent too, but `isHelper` drops their events
before any of this.

**A parent is not a subscription, and the mute covers both anyway — a known gap, kept on purpose.**
In Paseo 0.9.0 the note to the parent comes from `setupFinishNotification`
(`packages/server/src/server/agent/agent-prompt.ts`), an in-memory subscription that stops at the
child's first finish, error or close while the parent label stays. `createAgentCommand` registers it
only when `notifyOnFinish` is true and the initial prompt started, and `send_agent_prompt` subscribes
whoever called it, parent or not. So two kinds of event are muted with nobody to speak for them:

- **a child's later turns** — the user opens a finished worker and prompts it directly, and its next
  question, error or finish is listed as "Not announced" and never reaches the parent;
- **a child started without a finish notification** — `notifyOnFinish: false`, or no initial prompt —
  which is muted from its first event.

Herald cannot tell these apart from the covered case: `PluginHookAgent` carries the parent id and
nothing about subscriptions, `agent.turn_started` does not say who prompted the turn, and a
`user_message` timeline item has no origin. Muting by parentage was chosen over announcing by default
(or guessing from the parent's timeline) and is pinned by the tests in `server/hooks.test.ts`. If the
plugin API ever exposes the subscription or a turn's origin, gate on that instead.

## `turn_ended` can repeat

The reference says a turn id can repeat after a session reopens, and the community `top` plugin has
seen the event fire twice for one turn. `isRepeatTurn` drops a second event for the same
`agentId:turnId` inside `TURN_REPEAT_WINDOW_MS`. A completed turn with no assistant text — a
compaction, a bare tool run — is dropped too; there is nothing to say.

A turn that **fails within `INTERRUPT_GRACE_MS` of the user denying a permission with `interrupt`**
is dropped as well. Claude reports that stop as a failed turn whose message is a diagnostic
(`[ede_diagnostic] … stop_reason=tool_use`); the user caused it and does not need to hear about it. A
plain deny lets the agent carry on, so a failure after one is real and is announced.

A streamed reply reaches the `turn_ended` snapshot as several `assistant_message` items that can split
anywhere, including inside a word, with the whitespace inside the chunks. `latestOutputText`
concatenates them as they are — the first version added a space at every seam and produced "c utoff".
The one exception is a sentence end followed by a capital letter, which is two messages from one turn
(text before and after a tool call) and gets a space.

## The summary card in the transcript

Besides the panel, every announced event leaves a card in the agent's own transcript, appended by
the daemon with `paseo.agents.ref(id).timeline.append`. It is appended as soon as the entry is
recorded — so it lands right after the turn or the question it is about, showing "Writing the
summary…" — and appended again under the same row id (`summary:<eventId>`) when the summary is ready
or has failed; the daemon replaces the row live and on refetch. It is written for the event, not for
the store: a summary that lands after the user has already moved on still completes its card, even
though `updateSummary` refuses it. A kind switched off in the config gets no card.

Both appends for one event go through a chain keyed by the row id (`chains` in `server/card.ts`):
they are started fire-and-forget and carry the same id, so a pending write held up by a slow round
trip could otherwise land after the summary that replaced it and strand the card on "Writing the
summary…".

The Play button speaks the sentence through the same announcer as everything else, so it follows the
engine and voice settings. Rows live in the daemon's memory — they survive scroll and reconnect, not
a daemon restart — and a host that predates plugin timeline rows rejects the append, which
`server/card.ts` reports once per distinct cause.

## A completion that was not one

Some providers report a turn as finished and keep working. Writing a summary takes seconds, and that
is exactly the window in which it happens, so the check is made *after* the summary comes back rather
than before it: `outran()` asks whether a turn we saw start has started since (the generation) or
whether one is in flight right now (`isAgentRunning`, deliberately uncached). If either says so the
entry is removed, nothing is announced, and the card is taken back.

**The daemon half of that question is for a `finished` event only.** An agent waiting on a question,
a plan or a permission reports `status: "running"` with the request pending, so asking whether it is
running would suppress every one of them — the whole point of the plugin. The generation half applies
to every reason, and is re-read *after* the round trip, since a turn can start while it is in flight
and the snapshot it answers with may predate it.

"Taken back" is as close as the host allows. A plugin timeline row cannot be deleted — appending the
same id *replaces* — so the replacement carries `superseded: true` and the renderer returns `null` for
it. It still has to be a complete, valid card: the client validates every row against
`HeraldCardSchema` and would draw a placeholder for one missing its summary.

**The same case is withheld while the summary is still being written**, or the panel would sit at
"Writing the summary…" for a finish that was not one. `Liveness` does it, because it already reads
each entry's agent and so never has to enumerate the running ones — a list the panel would have had
to page through, and would silently truncate. A `finished` entry is judged on a snapshot no older
than `RUNNING_TTL_MS`, since that is the one fact here that turns over in seconds, and a running
agent yields `working`: hidden but kept, because the hooks take the entry back for good when its
summary lands. Every other reason keeps the long cache, an agent waiting on a question being
*running* too.

The panel still drops a **Paseo-flagged** row of its own, in `isCurrent`, where the status arrives
with the row and no cross-reference is needed.

## The work is named by its workspace

Agents are almost always untitled, so "Untitled agent" is what an agent title would show. The hooks
look up the workspace's title (`server/workspaces.ts`, cached five minutes) and store it on the entry;
the fallback sentence, the helper's prompt, and the panel's card title all use `displayName`: the
agent's own title when it has one, else the workspace's. The card shows the agent title, if any, as
the line under the workspace title — or, for an untitled agent, the start of what it was last asked
(`lastRequest`), because two untitled agents in one workspace would otherwise read as one.

The whole panel card opens the session (`navigation.openAgent`); the speaker icon right after the
title speaks the sentence again — beside the title rather than at the card's edge, where it went
unseen. They nest, and the inner pressable takes the touch. The transcript card's play icon sits the
same way, right after its label.

## What the store means

One entry per agent, the most recent reason it is waiting. Entries are removed when the hooks see the
agent move on: `turn_started` (the user replied), `permission_resolved` for the entry's request,
`archived`. They are *not* removed when the user merely looks at the agent — Paseo's
`requiresAttention` flag handles that, and the panel lists the union of Paseo's flagged agents and
Herald's entries, joined by agent id. Herald explains; Paseo decides who is listed.

**There is no age limit, on purpose.** A question asked a week ago is still unanswered. What clears
Paseo's flag is the user: viewing the agent or closing its tab (observed 2026-09-16 — the tab label
`paseo.open-agent-tab.<clientId>` flipped to `"false"` and `requiresAttention` went with it), or the
next message to it. The hooks hear none of that, nor a session *closing* (daemon restart, provider
gone), so `server/liveness.ts` asks the daemon about each entry's agent before the list goes out
(cached 30 s):

- **closed** session: hidden but kept, since opening the agent resumes it and the summary is still the
  thing to show;
- **seen**: no attention flag, no pending permission, and the entry at least `SEEN_GRACE_MS` old —
  removed, the user has been there. The grace exists because Paseo sets its flag a few milliseconds
  *after* the event Herald recorded, so a brand-new entry must not be judged by a flag not yet set;
- **archived** or **missing**: removed for good.

The panel applies the closed rule to Paseo-only rows too (`isCurrent` in `client/herald.tsx`). A row
with no Herald entry says so, because the event predates the plugin watching that agent. Net effect:
Paseo decides who is waiting; Herald explains why.

`attention.json` mirrors the map so a plugin reload keeps the sentences already written. A summary
still `pending` at load is marked `failed` with the fallback, because its helper died with the old
process.

**`load()` merges, it does not overwrite.** A contribution registers its handlers synchronously — it
returns a cleanup, not a promise — so the file read cannot be awaited first and events arrive during
it. Anything live is newer than anything on disk, so `load` skips every agent in `touched`, the set
of agents upserted or removed since the store was made. Without that, an announcement that arrived
mid-read would vanish under the older persisted entry for the same agent.

`removeIf` needs one more step than `remove`. `remove` marks its agent `touched` whether or not an
entry is there, so the merge skips it either way; `removeIf` cannot, because its test needs the entry
still on disk. So a conditional removal that arrives mid-read is *held* and applied to that entry as
it is merged — without it, a permission answered during the read comes back with the merge and sits
in the panel until liveness clears it.

Merging in memory is only half of it: that live upsert also *queued a write*. Left alone it would
truncate the file mid-read and then save a map that had not been merged yet, erasing from
`attention.json` the very rows just read out of it. So `persist` holds any write queued while
`loading` is set until the read finishes, and serialises inside the write callback rather than at the
call — the file mirrors the map, it is not a log, so writing the latest state is always right.

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

**A browser grants audio to the task its gesture ran in, so every press handler calls `primeSpeech()`
before its first `await`.** The real delivery is always too late — it awaits the settings, and on the
`say` engine a render RPC — so `primeSpeech` starts a silent clip and an inaudible utterance inside
the press itself, which unlocks both engines. `playAudio` then reuses that one element, because
WebKit unlocks the element rather than the page. This is what makes "tap Test voice once" work; take
it out and browser announcements never start.

**The switches mean what they say, and a blocked press says so.** `blockedMessage()` is the single
gate — *Mute here*, the master switch, then the platform switch — and it returns the reason rather
than a boolean. The poll drops a blocked announcement silently; the panel speaker and the transcript
Play hand the reason to a toast, because a control that merely did nothing could not explain itself.

*Test voice* is the one exception, and passes `{ force: true }`. It is how the voice is checked while
announcements are off, and on the web it is the press that hands the browser its audio permission —
gating it would disable it exactly when someone is trying to get sound working.

**Every play control is hidden where `canPlaySpeech()` is false**, rather than shown and failing when
pressed: the panel row's speaker, the transcript card's play icon, and the panel header's *Mute here*
and *Test voice*. The settings screen's whole Voice section goes the same way. That covers phones and
a browser with neither audio playback nor speech synthesis. The upstream ask that would change this
is a host-provided player in `@getpaseo/plugin/client/react-native`, next to `copyText` — the app
already has one behind `useVoiceAudioEngineOptional`, which plays voice mode's base64 `audio_output`
chunks on every platform.

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
model, and the prompt template — so it is the daemon's file behind `herald.config.read` /
`herald.config.write`.

## Long lists do not fit a `SettingsSelect`

The host's `SettingsSelect` popover does not scroll. It is fine for the four speeds and the two
voice sources and useless for a Mac's `say` voices — 185 of them in 51 languages on the daemon this
was built against — or a browser's voices or every provider's models. Those three use
`client/option-picker.tsx`: a `SettingsRow` whose control opens a host `Modal` with scrolling turned
off, so the host `FlatList` inside it is what scrolls, above a host `TextInput` that filters by label,
detail, or value. Keep `SettingsSelect` for anything under about ten options and reach for the picker
past that.

`SettingsInput` is one line, which is why the prompt is not one: `client/prompt-editor.tsx` is the
same shape as the picker — a `SettingsRow` opening a `Modal.Content scrollable={false}` — with a
multiline host `TextInput` taking the body. Its draft is local until *Save*, so *Cancel* cancels and
the daemon is not written per keystroke.

## The SDK's state hooks do not work in a surface

`useWorkspace` and `useAgent` throw "Plugin state hooks must run inside a workspace panel" when
called from a sidebar surface — they are for `addWorkspacePanel` components, which have a workspace
or agent in scope. The first shipped panel used one for the workspace name and failed on mount.
`client/herald.tsx` lists workspaces through the host API on each refresh and maps id to title
instead. Anything a surface needs to know about workspaces or agents goes through `usePaseo()`.

The header's gear is the other half of that gap: a surface is given no `openSettings` either, so
`index.client.tsx` lends it one through `bindSettingsOpener`, and the button is hidden while nothing
is bound. Keep the binding cleared in the contribution's cleanup — the module outlives a
disconnected client's context.

## Paseo's agent stream has to be asked for

Both the announcer and the surface poll, and use Paseo's agent stream only to poll *sooner*. Since
Paseo 0.9 that stream is silent unless the plugin opens an observation: `paseo.agents.subscribe()`
is a local listener fed only by an `agents.list({ subscribe: {} })` the same API instance made, and
each plugin runtime has its own instance. Herald's bare `subscribe()` calls predate that change, so
on 0.9 every nudge was lost and everything waited for the ten-second tick — slower, never wrong.

`client/agents.ts` opens the observation. The snapshot is ignored and asked for one agent long: the
polls read the full lists, and the daemon filters an observation's updates by `filter`, not by page,
so a one-agent page still hears every agent. Paseo re-requests the observation after a reconnect but
releases one whose request fails without telling the listeners, so `watchAgents` catches that
through `error` and reopens it with backoff. The surface opens it in an effect of its own, so the
poll's pace changing does not close and reopen it.

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
5. Edit the summary prompt — "Answer in French" is enough — and trigger an event: the next sentence
   follows it. *Restore the default* and *Save* puts it back.
6. `paseo ls -a -g --label herald.role=summarizer -q` after a few summaries: empty. Switch *Delete
   the helper when it is done* off, trigger one more, and the helper is there.
