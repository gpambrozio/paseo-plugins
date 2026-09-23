## What this changes

<!-- One or two sentences. Which plugin, and what's different for the person using it. -->

## Plugin(s) touched

- [ ] `skills`
- [ ] `github-board`
- [ ] `launchd-jobs`
- [ ] `herald`
- [ ] `model-pricing`
- [ ] `firstmate`
- [ ] Repo-level (docs, CI, config)

## Checks

<!-- The first three are also enforced by `checks.yml`, which must pass before this can merge.
     Running them locally first is still faster than waiting for CI to tell you. -->

- [ ] `npm run typecheck` passes in every plugin I touched
- [ ] `npm test` passes in every plugin I touched
- [ ] I ran `npm install` in any plugin whose `package.json` I edited, so its lockfile moved with it
- [ ] `paseo plugin reload <id>` loads cleanly against a real daemon

## UI

<!-- Skip if this touches nothing under client/. There's no UI harness, so a clean typecheck proves
     nothing about how it renders. Say what you looked at and where. -->

- [ ] Not applicable
- [ ] Checked on desktop (web export, V8)
- [ ] Checked on iOS / Android (Hermes)

## Paseo version

<!-- If this calls a host API, which is the oldest daemon that supports it? An older daemon must
     still load the plugin with only the new feature missing. -->
