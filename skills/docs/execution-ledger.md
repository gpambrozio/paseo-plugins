# SDD ledger — plan: docs/superpowers/plans/2026-08-20-agent-skills-panel.md

Spec: docs/superpowers/specs/2026-08-20-agent-skills-panel-design.md (read, binding authority)
Isolation: work happens in a NEW repo at ~/Development/paseo-skills (git init in Task 1).
No worktree in the paseo checkout — the plan forbids touching it.

## Preflight environment checks
- `paseo` CLI 0.5.0-beta.3 at ~/.local/bin/paseo; `plugin init/ls/install/reload/logs/enable/disable/remove` all present.
- `~/.paseo/config.json` already has `pluginsEnabled: true`, `plugins: {}` — Task 1 Step 1 needs no config edit and no permission ask.
- `paseo plugin init` probe into a temp dir: generated `paseo-plugin.d.ts` contains all 9 symbols the plan's code uses (addWorkspacePanel, addCommandCenterItem, useAgent, PluginAgentPanelProps, PluginHandlerContext). Scaffold devDeps match the plan's expectation. Probe deleted.
- `@getpaseo/client@0.4.0` is published, so the scaffold's `^0.4.0` pin installs.
- `~/Development/paseo-skills` does not exist — init will not hit the empty-dir guard.

## Preflight conflict scan

### Cross-task: shared files and interfaces
| Producer | Consumer | Interface | Finding |
| --- | --- | --- | --- |
| T1 (scaffold index.ts, main.client.tsx) | T6 (rewrites index.ts, deletes main.client.tsx) | file ownership | Clean — T6 replaces wholesale, nothing else imports main.client.tsx |
| T2 `parseFrontmatter(raw) -> {frontmatter, body}` | T3 skill-directory.server.ts | frontmatter.name/.description | Clean — same shape both sides |
| T2 `parseFrontmatter` | T5 skills.server.ts (body for read) | `.body` | Clean |
| T3 `readSkillsFromDirectory(dir, kind, label, nameFor?)` | T4 claude.server.ts | 4th arg `(name) => \`${plugin}:${name}\`` | Clean after preflight fix — plan's Task 3 Interfaces block originally declared a 2-arg nameFor; corrected to 1-arg to match the implementation and T4's call site |
| T3 `dedupeByName`, `SkillEntry`, `makeSkillId` | T4 | first-wins dedupe | Clean |
| T3 `resolveCodexSkills({cwd, codexHome})` | T5 dispatch | options object | Clean |
| T4 `resolveClaudeSkills({cwd, claudeHome})` | T5 dispatch | options object | Clean |
| T5 `listSkills`, `SkillEntrySchema` | T6 panel + index | named exports from skills.shared.ts | Clean — both exported |
| T5 `readSkill` | T7 detail view | named export | Clean |
| T5 `createListSkillsHandler()`, `createReadSkillHandler()` | T6 index.ts | zero-arg default roots | Clean — defaults to defaultSkillRoots() |
| T6 `MONO`, `styles.row`, `search`/`selectedSkillId` state | T7 edits | in-file symbols | Clean — T7 patches only symbols T6 defines |
| T6 `SkillsPanel` | T6 index.ts panel id `skills` | Command Center `openPanel("skills")` | Clean — ids match |
| T8 moves spec+plan out of paseo repo | — | — | Conflict: see Ruling 2 |

### Per-task self-consistency
| Task | Tests specified vs expected count | Files created vs later touched | Finding |
| --- | --- | --- | --- |
| T1 | n/a (no tests) | creates project; typecheck+install verify | Clean |
| T2 | 8 tests written, step asserts 8 | frontmatter.ts consumed by T3/T5 | Clean |
| T3 | 6 codex + 3 repo-root; step asserts 9 plus T2's 8 via `vitest run resolve/` | 4 files created, all consumed later | TDD-order deviation: see Ruling 3 |
| T4 | 8 tests, step asserts 8 | claude.server.ts consumed by T5 | Clean |
| T5 | 4 list + 2 roots + 2 read = 8; step asserts 8 | shared+server consumed by T6/T7 | Clean |
| T6 | no automated tests (UI); manual steps | index.ts + panel.client.tsx | Manual-verification gap: see Ruling 4 |
| T7 | no automated tests (UI); manual steps | panel.client.tsx only | Manual-verification gap: see Ruling 4 |
| T8 | no tests; final typecheck+suite | moves docs, deletes from paseo | Conflict: see Ruling 2 |

## Rulings

Ruling 1: Skip Task 1 Step 1's config edit and permission ask — `pluginsEnabled` is already `true` on the target daemon, so there is nothing to enable and nothing to ask. Installing the plugin the user explicitly asked for is the requested work. Cost if wrong: none; the state was read directly from ~/.paseo/config.json.

Ruling 2: Task 8 Step 3 asserts `git status --porcelain` in the paseo checkout is empty, but this SDD workspace lives at paseo/.superpowers/ and that path is NOT git-ignored in this repo. Amend the check to exclude `.superpowers/`, which is scratch deleted at the end of this skill anyway. Cost if wrong: a stray untracked scratch dir survives in the paseo checkout; visible in git status and removable with one rm.

Ruling 3: Task 3 writes skill-entry.ts and skill-directory.server.ts (Step 1) before its tests (Step 2), which inverts TDD. Proceeding as written: those two modules are the fixtures the codex tests exercise, and tests written first could not even import them. The codex and repo-root tests are still written before codex.server.ts and repo-root.server.ts exist and must be seen failing. Cost if wrong: two helper modules land without a red-first cycle; they are covered by the tests that follow in the same task.

Ruling 4: Tasks 1, 6, and 7 end in manual in-app verification a subagent cannot perform (sidebar item renders, panel opens from Command Center, Invoke actually runs the skill). Implementers verify everything CLI-observable — typecheck, tests, `paseo plugin ls`, `paseo plugin reload`, `paseo plugin logs` clean — and I surface the in-app checks to the user at the end rather than letting an implementer claim them. Cost if wrong: a UI defect reaches the user's hands unverified; caught the first time they open the panel.

Ruling 5: Keep the scaffold's `@getpaseo/client: ^0.4.0` pin even though the daemon is 0.5.0-beta.3. It only supplies the PaseoApi type for local typechecking, and the APIs used (agents.ref/refresh/current/send) long predate 0.4.0. If typecheck fails on a missing member, the implementer bumps to ^0.5.0-beta.3. Cost if wrong: one dependency bump in Task 5 or 6.

## Progress

Ruling 6: Review packages must be generated with cwd=~/Development/paseo-skills (the commits live in that repo, not the paseo checkout), passing an explicit OUTFILE inside this workspace. Task 1's BASE is the empty tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 because the repo starts with no parent commit. Cost if wrong: a malformed diff file, regenerable.

Ruling 7 (plan defect): Task 1 never specified a .gitignore, and its commit step says `git add -A`, so the implementer committed all 362 installed packages — ~900KB of node_modules in the initial commit. Corrected the plan to write `.gitignore` with `node_modules/` before `npm install`, and to check `git status --short` before committing. Directing the implementer to add the ignore file and amend the initial commit rather than adding a follow-up removal commit: the repo is two minutes old, has one commit, and has no remote, so rewriting it is safe and keeps the dependency tree out of history permanently. Cost if wrong: a rewritten SHA in a repo that exists only on this machine and that nobody has cloned.

Task 1: review 1 — spec ❌, quality Needs fixes. 2 Important (both plan defects), 1 Minor.

Ruling 8 (plan defect): `paseo plugin init <dir>` derives the manifest id from the directory basename, so the plugin installed as `paseo-skills` while the spec and every later task say `skills`. Verified on the real daemon: config key is `paseo-skills`. Correcting the manifest to `"id": "skills"`, removing the stale `paseo-skills` config entry, and reinstalling — rather than rewriting every later task to say `paseo-skills` — because the spec names `skills` and it is the shorter, stabler id. Cost if wrong: one config key differs from the manifest; `paseo plugin remove` plus reinstall corrects it.

Ruling 9 (plan defect): Task 1's Interfaces block guarantees `npm test` passes, but `vitest run` exits 1 with "No test files found" until Task 2 adds tests. Amended the script to `vitest run --passWithNoTests`. Cost if wrong: none — the flag only changes the empty-suite case, and every later task has test files.

Task 1: minor (deferred): .gitignore covers only node_modules/; adding .DS_Store, dist/, coverage/ would harden future `git add -A` (reviewer, .gitignore:1).

Task 1: fix round 1/5 (2 addressed, 0 open — plugin id now `skills`, npm test exits 0 with --passWithNoTests; commits 4dd61dc..9976ce8)
Task 1: controller-verified independently — manifest id `skills`, daemon config holds exactly one key `skills` (stale `paseo-skills` gone), npm test exit 0, typecheck exit 0, 8 tracked files with no node_modules.
Task 1: NOT yet closed — scoped re-review of the fix diff is still owed, and is deliberately held: I asked the user whether to keep running against the production daemon (~/.paseo) or move to the dev daemon, and that answer changes Task 1's install verification. No further dispatches until the user answers.

Ruling 10 (plan defect): Task 1 Step 6 told the implementer to confirm a "Greeting" sidebar item renders in the app. The CLI scaffold registers `addSurface("main", MainSurface)` with no `addSidebarItem`, so no sidebar entry exists and the check was never performable — the docs example includes addSidebarItem but the generated ENTRY does not. Corrected Step 6 to state that `paseo plugin ls` showing `skills` running IS the verification at this stage. Cost if wrong: none; the corrected text describes what the scaffold actually does, verified by reading the generated index.ts.
Task 1: re-review clean — both findings ADDRESSED, no new breakage.
Task 1: complete (commits 4dd61dc..9976ce8, review clean after 1 fix round)

Task 2: complete (commits 9976ce8..9728dce, review approved) — but see Ruling 11.

Ruling 11 (plan defect, my parser design): Task 2's reviewer found that the frontmatter parser I specified silently corrupts two real YAML shapes instead of degrading to "not a skill" as its own JSDoc promises. Reproduced on this machine: ~/.claude/skills/example-folded-skill/SKILL.md uses `description: >` with four indented continuation lines; the parser sets description to the literal ">" and drops the rest, so that skill would render in the panel with a one-character description. Second case: an indented nested key (`metadata:` then `  name: bar`) has its key .trim()ed and overwrites the top-level `name` that both resolvers use to identify the skill. Ruling: fix the parser rather than document the limitation — support `>` (fold to spaces) and `|` (keep newlines) block scalars, ignore indented lines as top-level keys, and trim the closing-fence comparison (the reviewer's Minor #2, folded in because it is the same silent-discard failure in the same function). Surveyed all of ~/.claude/skills and ~/.claude/plugins/cache: exactly one file uses a block scalar today, none use nested keys, so the blast radius is small but visible in the first UI the user will look at. Cost if wrong: a more permissive parser accepts frontmatter shapes real Claude would reject, listing a skill the agent cannot actually invoke.

Ruling 12: The frontmatter fix is QUEUED, not dispatched — Task 4's implementer is live and committing in the same repo, and two concurrent implementers risk clobbering each other's index. Dispatching the fix as a Task 2 fix round once Task 4 reports. Cost if wrong: a few minutes of serialization.

Task 2: minor (deferred): both fallback branches return un-normalized `raw` while the success path returns CRLF-normalized text (reviewer, frontmatter.ts:104,116) — inconsistent but harmless; no test combines CRLF with a fallback.

Task 3: complete (commits 9728dce..ec5e84a, review approved, 1 Important plan-mandated deferred to Ruling 13)
Task 3: minor (deferred): no test asserts the shape of SkillEntry.id from makeSkillId (reviewer); codex.server.ts:25 re-derives dirname(cwd) independently of repoRoot, inherited from the mirrored production function, worth a comment.

Ruling 13 (plan defect): Task 3's reviewer found `resolveCodexSkills` returns `dedupeByName(resolved.flat())` with no final sort, while the production function it mirrors (codex-app-server-agent.ts:756) ends with a full alphabetical sort over the deduped set. readSkillsFromDirectory sorts only within one directory, so a workspace with skills in two source directories lists them grouped-then-alphabetical, and the panel would disagree with the Codex composer's slash-command order. The same omission exists in resolveClaudeSkills. Ruling: add the alphabetical sort to both resolvers plus a test with two populated groups. Cost if wrong: list ordering differs from the composer in a way nobody notices; the fix is one line per resolver.

Ruling 14: Batching the sort fix (Ruling 13) with whatever Task 4's review returns, rather than dispatching it now — the sort touches claude.server.ts, which is the file Task 4's reviewer is currently reviewing. The parser fix (Ruling 11) goes now because it touches only frontmatter.ts/.test.ts, which that reviewer was explicitly told to ignore. Cost if wrong: one extra fix round.

Task 4: complete (commits ec5e84a..b2b61f5, review approved, no Critical/Important)
Task 4: reviewer independently re-confirmed on the live checkout that the temporary real-machine test file was deleted and the tree is clean, and traced the isInside prefix-collision guard (/foo/bar-baz correctly rejected as inside /foo/bar).
Task 4: minor (deferred): no dedicated test for the prefix-collision case; no dedicated test for a manifest entry missing installPath or a non-array per-plugin value (both traced sound, neither brief-mandated).
Task 2: fix round 1/5 (Ruling 11 addressed — block scalars, indented-key clobbering, closing-fence whitespace; 6 new tests; 14/14 frontmatter, 31/31 suite; commit bb9f964). Scoped re-review still owed.
Task 3: fix round 1/5 dispatched (Ruling 13 — final alphabetical sort in both resolvers + 2 tests).
Open verification to do at Task 6: confirm ~/.claude/skills/example-folded-skill renders its full folded description in the panel, not ">". That file is the real-world reproduction behind Ruling 11.
Task 2: fix round 1/5 re-review clean (Finding A ADDRESSED, all three sub-parts; RED evidence was genuine assertion failures, not module errors)
Task 2: complete (commits 9976ce8..bb9f964, review clean after 1 fix round)
Task 3: fix round 1/5 re-review clean (Finding B ADDRESSED in both resolvers; dedupe-before-sort traced correct — dedupe keys by first-seen precedence, sort only reorders the already-unique set)
Task 3: complete (commits 9728dce..333925c, review clean after 1 fix round)
Open verification item CLOSED: re-reviewer confirmed against the real ~/.claude/skills/example-folded-skill/SKILL.md that description now parses as the full folded sentence.
Task 2: minor (deferred): unquote() is not applied to block-scalar continuation lines, so a quoted continuation keeps its literal quotes (re-reviewer, out of scope).

Ruling 15 (plan defect, caught by the implementer): Task 5's brief contained two verbatim code blocks that disagreed — the handler threw "Skill is no longer available: ..." while the safety test asserted /not available/, which does not match that string. The implementer changed the implementation's message to "Skill not available: ..." and left the test untouched. Accepting: the test is the security-relevant assertion (a crafted skillId must throw rather than reach readFile), so keeping it intact and correcting the message is the right direction, and the new wording covers both the vanished-skill and crafted-id cases. Cost if wrong: an error string reads slightly less specific than intended.

Task 5: complete (commits 333925c..c0ce355, review approved; 1 Important finding is pre-existing scaffold, see Ruling 16)
Task 5: reviewer independently traced the security path and confirmed a crafted skillId cannot reach readFile — the throw precedes readFile and the path read comes from the discovered SkillEntry, never from client input. Also confirmed the implementer fixed the message rather than weakening the security test (test file diffed line-by-line against the brief: identical).
Task 5: minor (deferred): listSkills output declares cwd nullable though the protocol guarantees a string; harmless superset.

Ruling 16 (my Ruling 5 was wrong): I ruled earlier that keeping the scaffold's `@getpaseo/client: ^0.4.0` pin was safe because the APIs used long predate it. Task 5's reviewer disproved that: 0.4.0 exports no `PaseoApi` at all (verified — zero occurrences in its dist/index.d.ts; 0.5.0-beta.3 exports it at index.d.ts:289). The generated paseo-plugin.d.ts imports that type, and tsconfig's skipLibCheck:true swallowed the unresolvable import, so PluginHandlerContext.paseo has been typing as `any` since Task 1 — meaning every `npm run typecheck` in this project has NOT been checking the paseo API call chain, including the security-relevant one in skills.server.ts. Ruling: bump to ^0.5.0-beta.3 (also the daemon's version) and re-run the typecheck to see what it now catches. Dispatching after Task 8's implementer finishes, since it is the only live writer. Cost if wrong: a newer client type surfaces pre-existing type errors that must then be fixed — which is the point, not a cost.

Task 6: complete (commits c0ce355..f6c8373, review approved; 1 Important plan-mandated → Ruling 17)
Task 6: reviewer verified every colour against the six-token list exhaustively, confirmed all hooks precede the early returns, and confirmed groupBySource cannot emit a duplicate group for non-adjacent same-label entries.
Task 6: minor (deferred): useAgent returns null on first render, so the panel fires one redundant identical fetch with queryKey [...,undefined] before cwd resolves; queryFn never uses cwd, so both calls return the same data.

Ruling 17 (plan defect caused by Ruling 13): Task 6's reviewer found that group ORDER in the panel is an accident of naming. My Ruling 13 made both resolvers sort globally alphabetically across source groups; groupBySource then emits groups in first-occurrence order over that flat list, so whichever source owns the alphabetically-first skill becomes the first group. A personal skill named "aardvark" would push Personal above Project, and the order would change as skills are added or renamed. The brief's own QA steps assume a stable "Project, Personal, plugin" / "Project, Repository, Codex home" order. Ruling: order groups by a fixed precedence keyed on source.kind (project, personal, codex-repo, codex-home, plugin), ties between plugin groups broken alphabetically by label; entries stay alphabetical within each group, which the global sort already guarantees. Cost if wrong: group order is fixed rather than data-dependent, which is what the design intended anyway.

Ruling 18: Batching Ruling 16 (client version bump, package.json) and Ruling 17 (group ordering, panel.client.tsx) into ONE fix dispatch after Task 8's implementer finishes. Different files, both small, and one dispatch means one scoped re-review instead of two. Cost if wrong: a single re-review has to cover two unrelated changes.

Task 8: complete pending re-review (commit c405980) — README written, design+plan moved to ~/Development/paseo-skills/docs/, paseo checkout verified clean, 41/41 tests, typecheck exit 0.

Ruling 19 (plan defect, caught by Task 8's implementer): my README file-layout table lists 8 files while the repo has 10 — resolve/skill-entry.ts and resolve/repo-root.server.ts are missing. The implementer reported it rather than silently editing, which is what I asked for. Ruling: add both rows, folded into the batched fix. Cost if wrong: none.

Batched fix dispatched (Rulings 16, 17, 19) to the Task 6 implementer: client version bump + stable group ordering + README rows.

Task 7: complete pending fix (commits f6c8373..b48e364, review approved; 1 Important plan-mandated → Ruling 20)
Task 7: reviewer verified the diff file against the real repo before reviewing it, confirmed hook ordering in both components, confirmed every colour token, and confirmed SkillDetail fully unmounts on back so args/copied/invokeError cannot leak between skills.

Ruling 20 (plan defect): the Invoke button has no re-entrancy guard. `onPress={() => void invoke(...)}` awaits the send before navigating back, so a double-tap on a slow connection fires two sends and invokes the skill twice on the user's agent. That is a real side effect on a live agent, not a cosmetic issue. Ruling: add an isInvoking state, disable the Pressable while a send is in flight, and short-circuit invoke() if already running. Cost if wrong: the button is briefly disabled after a tap.

Ruling 21: folding the reviewer's Minor (copyToClipboard sets "Copied" optimistically and leaves an unhandled promise rejection when navigator.clipboard.writeText fails) into the same fix, against the usual rule that minors do not enter the fix loop. Reason: it is three lines in the same component we are already editing, and an unhandled rejection is console noise in the user's browser. Cost if wrong: one extra small change riding along in a fix round.

Fix wave re-review clean: Findings A-E all ADDRESSED (client bump verified against the installed tree, group precedence, README rows, invoke guard, clipboard confirmation). Re-reviewer traced the isInvoking asymmetry and confirmed no path strands the button — SkillDetail fully unmounts on back, so useState reinitializes.
Task 6: complete (commits c0ce355..4b4699f, review clean after 1 fix round)
Task 7: complete (commits f6c8373..b719248, review clean after 1 fix round)
Task 8: complete (commit c405980, verified by controller: docs/design.md and docs/plan.md present, paseo checkout clean)
Task 7: minor (deferred): the back Pressable is not gated by isInvoking, so navigating back mid-send lets setState fire on an unmounted component — React dev warning, no crash, pre-existing.

All 8 tasks complete. 12 commits, 41 tests passing, plugin running in the daemon. Final whole-branch review dispatched on opus.

FINAL WHOLE-BRANCH REVIEW (opus) returned: no Critical, 4 Important, 6 Minor. Verdict "yes, with one caveat I would fix first."

Ruling 22 (real bug, controller-verified): the final reviewer found that resolve/claude.server.ts gates plugin entries on `scope === "project"`, but the real manifest carries FIVE `scope: "local"` entries that each have a projectPath (plugin-dev→project-a, plugin-b→project-b, plugin-d→project-c and →project-d, plugin-e→project-e), and exactly one `local` entry with no projectPath (swift-lsp). I dumped the manifest and confirmed all of it. Consequence: an agent in ~/Development/paseo is shown 7 plugin-dev:* skills it does not have. Ruling: key the scoping test on the presence of a projectPath, not on the scope string. Cost if wrong: a plugin that should apply everywhere gets hidden — but the manifest data says otherwise for every entry on this machine.

Ruling 23 (real bug, controller-verified): four real SKILL.md files set `user-invocable: false` (the dox-read-jira-ticket skills). The panel lists them with a working-looking Invoke button; pressing it sends an unresolvable slash command that both providers pass through as literal text into the agent's transcript, and we navigate back as if it succeeded. Ruling: carry userInvocable on SkillEntry and through the zod schema, and replace the Invoke button with an explanatory note when false. Cost if wrong: a skill that is invocable gets its button hidden because its frontmatter says otherwise.

Ruling 24: fixing the ~7s error delay (host QueryClient uses react-query's retry:3 default; our handler errors are deterministic) with retry:false, and gating the list query on `agent != null` plus an explicit "agent no longer available" branch so a disabled query cannot spin forever.

Ruling 25: correcting docs/design.md for three things the reviewer caught it claiming or omitting — the plugin scoping rule, that Claude's ~18 built-in/bundled skills are invisible to filesystem discovery, and that the Codex mirror follows a fallback path Paseo uses only when Codex's own skills/list RPC fails (so a disabled Codex skill will appear in our panel).

Ruling 26: NOT fixing three of the reviewer's minors — no SKILL.md size cap (latent; largest real file is unremarkable), no refresh affordance (new surface, not a defect), and the frozen paseo-plugin.d.ts (informational). Also explicitly NOT applying unquote() to block-scalar continuations: the final reviewer corrected an earlier reviewer here, and applying it would corrupt a real skill whose folded description contains quoted phrases. Cost if wrong: the user hits one of these later; each is independently fixable.
Final fix wave re-review clean: all 6 findings ADDRESSED. Schema/type coherence for userInvocable verified across all three sites; hook ordering confirmed; frontmatter.ts confirmed untouched.
Re-reviewer noted one out-of-scope UX quirk (deferred): if the agent disappears while the detail sub-screen is open, the selectedSkillId branch still renders SkillDetail rather than the "agent no longer available" message, because it is checked first.
Re-reviewer noted one parse edge (deferred): `user-invocable: False` with a capital F would be misread as invocable. Every real occurrence on this machine is lowercase.
PROJECT COMPLETE: 13 commits, 47 tests passing, plugin running in the user's daemon at ~/.paseo.

## 2026-08-25 — issue #3, "Doesn't load all skills that the workspace has access to"

Reporter sees 7 Codex skills in the panel and has 113 in `~/.agents/skills`.

Ruling 27 (root cause): the panel mirrored Paseo's `listCodexSkills`, which scans `.codex/skills`.
Codex's own docs scan `.agents/skills` — repo walk, then `$HOME/.agents/skills`, then
`/etc/codex/skills`. Paseo's function is a fallback used only when Codex's `skills/list` RPC
fails, so it can be stale without anyone noticing; the composer lists what Codex reports. Ruling:
follow the documented search path, and treat "agrees with Paseo's fallback" as no longer a goal.
Cost if wrong: if a Codex build still keyed on `.codex/skills` alone, nothing regresses — that
directory is still read, one rank lower.

Ruling 28: `docs/design.md`'s "Deliberately not read: `~/.agents/skills`" was wrong twice.
`dedupeByName` collapses same-named entries, so reading it doubles nothing (verified: `~/.agents/skills`
and `~/.codex/skills` on this machine hold byte-identical copies of the same seven Paseo skills,
and the resolver now lists them once, sourced from `.agents`). And the orchestration sync only
mirrors the skills Paseo ships — a user's own `~/.agents/skills` entries were mirrored nowhere.
Cost if wrong: none found; the claim was checked against the real directories, not fixtures.

Ruling 29: fix the same bug class in the Claude resolver in the same pass, though the issue does
not mention it. Claude loads `.claude/skills` from every parent of cwd up to the repo root; the
resolver read `<cwd>/.claude/skills` alone, so an agent started in a subdirectory saw none of the
repository's skills. Cost if wrong: a wider walk lists a skill the agent does not have — bounded
by the repo root, which is where Claude stops too.

Ruling 30: rename the source kinds from directory-shaped (`codex-home`, `codex-repo`) to
scope-shaped (`project`, `repo`, `personal`, `admin`, `plugin`). Several directories now feed one
scope, so a kind cannot name a directory any more. Ids are transient — `skills.read` re-runs
discovery — so nothing persisted breaks. Cost if wrong: three files to edit back
(`skill-entry.ts`, `skills.shared.ts`, `panel.client.tsx`).

Ruling 31: NOT reading `~/.codex/config.toml` for `[[skills.config]]` disables, NOT scanning
`~/.codex/skills/.system`, and NOT rendering shadowed duplicates, though Codex shows them. All
three are recorded under Limitations and Future seams instead. Cost if wrong: a disabled skill
still shows an Invoke button, as it did before this change.
