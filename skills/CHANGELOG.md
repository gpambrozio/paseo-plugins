# Changelog

Notable changes to `skills`. The other plugins in this repository version separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Nothing here is published to a
registry: `paseo plugin add` follows a branch unless you pin `--ref <tag>`, so a version is a tag to
pin and a line to read before you move.

## [0.1.0] — 2026-09-08

The first numbered release. The plugin itself is older than this entry — it simply had no version
until now, so everything it does is listed here rather than split across releases it never had. See
the git history for how each part arrived.

### Added

- **A Skills pill above an agent's composer**, badged with how many skills that agent can use. Press
  it for the full list. ⌘K and **Skills** reaches the same panel, with a workspace tab holding an
  agent in focus.
- **Every skill the agent can actually use, grouped by where it comes from** — the project, the
  repository, your personal folder, your machine, or a plugin — so two skills with the same name are
  told apart by origin rather than guessed at. A search box filters by name and description.
- **What a skill actually says.** Opening one shows its description, the file it lives in, and its
  full instructions as written. **Copy path** takes the location, for when you want to edit it.
- **Invoke, with optional arguments.** Runs the skill on the agent you opened the panel from, and
  takes you to that agent so you can watch it work. A double press cannot send it twice.
- **Skills the agent can use but you cannot run yourself** are listed with a note saying so, instead
  of a button that would not have worked.
- **Works with every provider.** Claude and Codex additionally have their skill files read from
  disk, which is what gives a skill its origin, its location, and its full text; every other
  provider lists what its running session reports — a name, a description, and an argument hint.
- **Requires Paseo 0.8.0 or newer**, on the computer running the daemon *and* on whatever you view
  the panel in. On anything older the plugin reports itself as incompatible rather than half
  working.
