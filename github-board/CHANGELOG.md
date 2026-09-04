# Changelog

Notable changes to `github-board`. The other plugin in this repository, `skills`, versions
separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Nothing here is published to a
registry: `paseo plugin add` follows a branch unless you pin `--ref <tag>`, so a version is a tag to
pin and a line to read before you move.

## [0.3.1] — 2026-09-03

### Fixed

- **Descriptions written in HTML now read the way they do on GitHub.** Dependabot's pull requests
  were the worst case: the panel showed the release notes as a wall of angle brackets. They now
  show as collapsible sections, closed by default like on GitHub, with the quoted changelog,
  headings, bullet lists, links and code inside them. The same goes for HTML anyone else pastes
  into a description or comment — line breaks, bold, links, images, quotes and tables.

## [0.3.0] — 2026-09-02

### Changed

- **Clicking a card opens it in a panel beside the board instead of in your browser.** The panel
  shows the title, who opened it, how many comments it has, its labels, whether it is still open
  or has since been closed or merged, who it is assigned to, and the full description, formatted
  the way GitHub shows it. A pull request also shows which branch it comes from and which it
  targets. **Open on GitHub** is in the panel next to **Send to chat**, so the browser is still one
  click away. The rest of the board dims and blurs while the panel is open; click it, or the
  close button, to go back.
- **The header buttons are icons now.** Refresh is an arrow, the prompt settings are a gear.

### Added

- **Load comments** at the bottom of the panel shows the conversation: the comments on an issue or
  pull request, or a discussion's comments with replies indented under them. The first 50 are
  shown, and the panel says if there are more.
- **Screenshots and other images** pasted into a description or a comment are shown in the panel,
  including on private repositories. Side-by-side image tables show as tables. Click an image to
  open the original.
- **The panel can be made wider or narrower** by dragging its left edge. The width you choose is
  kept, even after a restart, and scales with the window.
- **A refresh button in the panel** reloads the description and comments if they were edited on
  GitHub since you opened them.

## [0.2.0] — 2026-08-31

### Changed

- **Send to chat opens the new agent through the host, not a hand-built URL.** Paseo 0.7.0-beta.3
  ([getpaseo/paseo#3901](https://github.com/getpaseo/paseo/pull/3901)) gives plugin surfaces a
  `navigation` prop, so the board asks the app to open the agent instead of constructing the app's
  private route and forcing the client onto it. On web and the desktop renderer this removes a
  `history.pushState`, a synthesized `popstate`, a 600 ms settle timer and the full page reload that
  fired whenever the router ignored the push — the agent's tab now opens directly, keeping client
  state.
- `@getpaseo/plugin` and `@getpaseo/client` move to 0.7.0 together, as the former peer-depends on
  the exact version of the latter. The contracts are byte-identical to 0.7.0-beta.3, where the
  navigation prop landed, so 0.7.0-beta.3 remains the honest floor for it.

### Compatibility

- **The old route is still live, and the gate is the app's version rather than the daemon's.** The
  `navigation` prop is supplied client-side, so whether the board gets it depends on the app
  rendering the surface, and one daemon serves several. Measured against a single 0.7.0-beta.3
  daemon on 2026-08-31: desktop navigated through the new API while the phone, whose app ships on
  its own cadence, received no prop and took the deep link. Both paths reach the same screen, so
  there is nothing to configure — but do not read the fallback as dead code.
- Nothing else changes for hosts older than 0.7.0-beta.3, and the plugin's floor is still Paseo
  0.5.2 for `paseo.projects.list()`.

## [0.1.0]

Everything before the versions above: the board itself. Issues, pull requests and discussions in
four columns; issues folded into the pull requests that close them; CI status on open pull requests;
right-click label editing; per-column prompt templates; repository filtering; the two-layer cache in
front of `gh`; the phone and tablet layout; and **Send to chat**, which creates the workspace,
starts the agent and sends the first message. See the git history for how each arrived.
