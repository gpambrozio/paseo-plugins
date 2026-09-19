# Herald

A [Paseo](https://paseo.sh) plugin that tells you, out loud, when one of your agents needs you.

When an agent asks a question, pauses for permission, wants a plan approved, finishes its turn, or
fails, Herald has a small helper agent write one spoken sentence about it — what is being asked and
the choices, or what was done and whether anything is left — and the Paseo app on your desk speaks
it. A **Herald** panel in the sidebar lists every agent waiting on you with that sentence. Tap a row
to open that session, or the speaker beside its title to hear the sentence again.

![The Herald panel: three finished agents, each headed by its workspace title with a speaker icon
beside it and how long ago it finished, then what the agent was last asked, its own last line, and
in italics the sentence Herald wrote about it. Mute here, Test voice, a refresh button and a settings
button sit in the header, next to a badge counting the agents waiting.](docs/panel.png)

## The sentence is in the conversation too

Every announced event also leaves a card in the agent's own transcript, right where the turn or the
question happened, with a play icon to hear it again. It is written as soon as the event lands, so it
reads "Writing the summary…" for the second or two the helper takes.

![A Herald card in an agent's conversation: a small panel headed "Herald · Finished" with a play
icon, and under it, in italics, the sentence written about the turn that just ended. The agent's
composer sits below it.](docs/timeline-card.png)

## What you need

- Paseo **0.8.0 or newer**, on the daemon and on the device running the app.
- Speech comes out of the device running the Paseo app, not the daemon machine. The voice, by
  default, is the daemon Mac's: it renders each sentence with `say` and the app plays the audio, so
  you hear the Mac's voices rather than a browser's. If the daemon is not a Mac, the browser's own
  voice is used. The **desktop app** speaks on its own. A **browser tab** speaks once you have pressed
  *Test voice* in the panel (browsers do not let a page play sound until it has been tapped). **Phones
  cannot speak** from a plugin yet; Herald can vibrate instead, and Paseo's own notifications already
  carry the text there.
- Summaries are written by a helper agent through whichever provider you pick, Claude Haiku 4.5 by
  default. Each event is one short turn of that model; the helper appears briefly under the agent it
  describes and is archived when it finishes.

## Install

```bash
paseo plugin install npm:@gpambrozio/paseo-herald
```

That is the shortest route on **Paseo 0.9 or newer**, which installs plugins straight from npm; add
`@<version>` to pin one. On 0.8, install from this repository instead:

```bash
paseo plugin add gpambrozio/paseo-plugins --path herald
```

Pin a repository install with `--ref herald/v<version>`. To hack on it, clone the repository and
`paseo plugin install "$PWD"` from this folder after `npm install` and `npm run typecheck`.

## Settings

**Settings › Plugins › Herald** — the gear in the panel's header, *Herald settings* from the Command
Center, or the settings screen itself.

- **Speech** — the master switch; whether the desktop app, browser tabs, and phones act on it; the
  voice source (the daemon Mac's `say` voices, or this device's browser voice), which voice, the
  speed; a test button. To add Mac voices, install them on the daemon Mac under System Settings ›
  Accessibility › Spoken Content. These are shared by every device connected to the daemon, and each
  device follows its own switch. *Mute here* in the panel silences just the device you are on until
  the app restarts.
- **Summaries** — the model that writes them, the prompt they are written from, and which kinds of
  event are announced: questions, plan approvals, tool permissions, finished turns, errors. A kind
  that is switched off still appears in the panel, without a summary and without being spoken.

### The prompt

*Summary prompt* opens the whole prompt the helper is given, to edit however you like — shorter
sentences, another language, more about what matters to you for a finished turn than for a question.
Herald fills in the parts that change per event wherever you put them:

| Placeholder | Filled with |
| --- | --- |
| `{{agent}}` | What the work is called: the agent's title, or its workspace's. |
| `{{workspace}}` | The workspace's title, or the folder name when it has none. |
| `{{folder}}` | The last part of the agent's working directory. |
| `{{event}}` | A sentence saying why the agent is waiting. |
| `{{headline}}` | The one line Herald builds without a model: the question, the command, "Finished". |
| `{{detail}}` | The choices, the command, or the start of the final message. Often empty. |
| `{{request}}` | What you last asked this agent for. Empty when the agent paused without one. |
| `{{output}}` | What the agent said since that message. Empty for a pause. |

A **line** whose placeholder has nothing to fill it for that event is left out whole, so keep a label
and its placeholder on the same line — `Detail: {{detail}}` simply disappears when there is no detail.
Anything else in double braces is sent as you typed it. *Restore the default* brings the original
prompt back, and an empty prompt is the default one.

The default prompt ends by asking for a small JSON object, which is what Herald reads the sentence
out of. You can drop that — Herald then speaks whatever the model replies, trimmed to the first 45
words — but the result is less predictable, so the editor says so.

## What the helper sees

With the default prompt, for a finished turn the helper is given what the agent said after your last
message, and your last message. For a question or permission it is given the question and the choices, or the command. That
text goes to the model you chose, through your own provider credentials, the same way the agent's own
work does.
