# Agent Skills Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Paseo plugin that lists the agent skills available to a given agent session, shows each skill's source and path, renders its full `SKILL.md`, and invokes it in that agent.

**Architecture:** A directory-source Paseo plugin living outside the Paseo repo. Its server half (a Node subprocess on the daemon machine) discovers skills on the filesystem with one resolver per provider and exposes two typed RPCs. Its client half (a React Native component running in the Paseo app) contributes an agent-context workspace panel plus a Command Center item.

**Tech Stack:** TypeScript, React Native, zod, `@tanstack/react-query`, vitest, the `@getpaseo/plugin` and `@getpaseo/plugin/server` SDK modules.

**Spec:** `docs/superpowers/specs/2026-08-20-agent-skills-panel-design.md`

## Global Constraints

- The plugin directory is `~/Development/paseo-skills`. Plugin id is `skills`.
- **Nothing in the Paseo repository changes.** No file under `~/Development/paseo` is edited by any task except the final task, which only moves this plan and its spec out.
- **Never restart the Paseo daemon.** It manages the user's running agents. Use `paseo plugin reload skills` and `paseo reload` only.
- File suffixes are load-bearing. `*.client.tsx` owns React and UI. `*.server.ts` owns Node APIs and filesystem access. `*.shared.ts` owns zod contracts used by both. Importing a `*.server` module from a client module, or a `*.client` module from a server module, fails compilation.
- Node built-ins (`node:fs/promises`, `node:path`, `node:os`) may be imported **only** from `*.server.ts` files and their tests.
- Client code may import only: `react`, `react-native`, `@tanstack/react-query`, `zod`, `@getpaseo/plugin`, `@getpaseo/plugin/server`. There is no clipboard package and no icon package.
- Relative imports are extensionless (`./frontmatter`, not `./frontmatter.js`). The plugin compiler resolves them.
- Every UI color comes from `theme.colors`. The only tokens that exist are `surface0`, `foreground`, `foregroundMuted`, `accent`, `accentForeground`, `statusDanger`. Never hardcode `#fff`, `#000`, or rely on React Native's default text color.
- Padding tightens when `layout.compact` is true.
- Contribution ids start with a lowercase letter and contain only lowercase letters, numbers, and hyphens.
- Commit after every task, in the plugin repo.

---

### Task 1: Scaffold the plugin and confirm it loads

Creates the project, adds the toolchain the scaffold omits (`@types/node`, vitest), and verifies end-to-end that a plugin can load in the user's daemon before any real code exists. Getting the integration smoke test out of the way first means later failures are unambiguously our code.

**Files:**
- Create: `~/Development/paseo-skills/` (via `paseo plugin init`)
- Modify: `~/Development/paseo-skills/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a working plugin project where `npm run typecheck` and `npm test` both pass, installed and loading in the daemon under id `skills`.

- [ ] **Step 1: Ask permission before enabling plugins**

The plugin system is off unless the daemon's `config.json` has `"pluginsEnabled": true`. Never flip that on a user's behalf. First check the current value:

```bash
grep -n '"pluginsEnabled"' ~/.paseo/config.json || echo "not set"
```

If it is not already `true`, ask the user for explicit permission, stating plainly: plugin code is trusted and unsandboxed — the server half can do anything on the daemon machine, and the client half runs inside the Paseo app. This plugin deliberately reads `~/.claude`, `~/.codex`, and the workspace directory. Do not proceed until they say yes.

If they approve, edit `~/.paseo/config.json` to set `"pluginsEnabled": true` at the root, then:

```bash
paseo reload
```

`paseo reload` re-reads config. It does not restart the daemon.

- [ ] **Step 2: Scaffold the project**

The target directory must not exist or must be empty — `paseo plugin init` refuses a non-empty directory.

```bash
paseo plugin init ~/Development/paseo-skills
```

Expected: writes `paseo-plugin.json`, `package.json`, `tsconfig.json`, `paseo-plugin.d.ts`, `index.ts`, `main.client.tsx`.

`init` derives the plugin id from the directory basename, so the manifest says `paseo-skills`. The id must be `skills` — every later task runs `paseo plugin reload skills`. Overwrite `~/Development/paseo-skills/paseo-plugin.json` with:

```json
{
  "id": "skills"
}
```

- [ ] **Step 3: Add the missing toolchain to package.json**

The scaffold has no `@types/node` (so `import path from "node:path"` will not typecheck) and no test runner. Edit `~/Development/paseo-skills/package.json` so `scripts` and `devDependencies` read:

```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "devDependencies": {
    "@getpaseo/client": "^0.4.0",
    "@tanstack/react-query": "^5.90.11",
    "@types/node": "^22.10.0",
    "@types/react": "~19.2.0",
    "react": "19.1.0",
    "react-native": "0.81.5",
    "typescript": "^5.9.3",
    "vitest": "^3.0.0",
    "zod": "^4.4.3"
  }
```

Leave `name`, `private`, and `version` as scaffolded.

- [ ] **Step 4: Install dependencies and initialize git**

The scaffold ships no `.gitignore`, and the commit step below uses `git add -A`. Write the ignore file before `npm install` so the dependency tree never has a chance to enter history. Create `~/Development/paseo-skills/.gitignore`:

```gitignore
node_modules/
```

Then:

```bash
cd ~/Development/paseo-skills
npm install
git init
```

- [ ] **Step 5: Verify the scaffold typechecks**

```bash
cd ~/Development/paseo-skills && npm run typecheck
```

Expected: exit 0, no output.

- [ ] **Step 6: Install the plugin and confirm it loads**

```bash
paseo plugin install ~/Development/paseo-skills
paseo plugin ls
paseo plugin logs skills
```

Expected: `paseo plugin ls` lists the plugin under the id **`skills`** — not `paseo-skills`. If it shows `paseo-skills`, the manifest edit in Step 2 was missed: fix the manifest, then `paseo plugin remove paseo-skills` before reinstalling, or the daemon keeps both config keys pointed at the same directory. `paseo plugin logs skills` shows `[paseo]` loading and ready entries with no errors.

There is nothing to see in the app at this stage. The CLI's scaffold calls `addSurface("main", MainSurface)` but never `addSidebarItem`, so the surface is registered with nothing navigating to it. `paseo plugin ls` showing `skills` as `running` IS this task's verification — it proves the daemon compiled and loaded the plugin. The first reachable UI arrives in Task 6.

If it does not load, stop and fix this before writing any real code. Every later task assumes this works.

- [ ] **Step 7: Commit**

```bash
cd ~/Development/paseo-skills
git add -A
git status --short
git commit -m "chore: scaffold paseo-skills plugin with node types and vitest"
```

`git status --short` must list only the scaffolded source files, `.gitignore`, and `package-lock.json`. If it lists anything under `node_modules/`, the ignore file is wrong — fix it before committing.

---

### Task 2: SKILL.md frontmatter parser

Both resolvers need to pull `name` and `description` out of a `SKILL.md` and hand back the body. This is the only piece with no I/O, so it is pure and tested exhaustively.

**Files:**
- Create: `~/Development/paseo-skills/resolve/frontmatter.ts`
- Test: `~/Development/paseo-skills/resolve/frontmatter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string }` — used by Task 3 and Task 4.

- [ ] **Step 1: Write the failing tests**

Create `~/Development/paseo-skills/resolve/frontmatter.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  test("reads name and description and returns the body", () => {
    const raw = "---\nname: brainstorming\ndescription: Turns ideas into designs\n---\n\n# Body\n\nText.\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.name).toBe("brainstorming");
    expect(result.frontmatter.description).toBe("Turns ideas into designs");
    expect(result.body).toBe("# Body\n\nText.\n");
  });

  test("keeps colons inside a value", () => {
    const raw = "---\ndescription: Use when: you are stuck\n---\nbody\n";
    expect(parseFrontmatter(raw).frontmatter.description).toBe("Use when: you are stuck");
  });

  test("strips surrounding quotes from a value", () => {
    const raw = "---\nname: \"my-skill\"\ndescription: 'single quoted'\n---\nbody\n";
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.name).toBe("my-skill");
    expect(frontmatter.description).toBe("single quoted");
  });

  test("normalizes CRLF line endings", () => {
    const raw = "---\r\nname: windows\r\n---\r\nbody\r\n";
    expect(parseFrontmatter(raw).frontmatter.name).toBe("windows");
  });

  test("treats a file with no frontmatter as all body", () => {
    const raw = "# Just a document\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("# Just a document\n");
  });

  test("treats unterminated frontmatter as all body", () => {
    const raw = "---\nname: broken\nstill going\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(raw);
  });

  test("ignores lines with no colon", () => {
    const raw = "---\nname: ok\njust-a-line\n---\nbody\n";
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({ name: "ok" });
  });

  test("ignores an empty key", () => {
    const raw = "---\n: value\nname: ok\n---\nbody\n";
    expect(parseFrontmatter(raw).frontmatter).toEqual({ name: "ok" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ~/Development/paseo-skills && npx vitest run resolve/frontmatter.test.ts
```

Expected: FAIL — cannot resolve `./frontmatter`.

- [ ] **Step 3: Write the implementation**

Create `~/Development/paseo-skills/resolve/frontmatter.ts`:

```ts
export interface ParsedSkillDocument {
  frontmatter: Record<string, string>;
  body: string;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Reads the leading `---` block of a SKILL.md. Deliberately minimal: skills use
 * flat single-line `key: value` pairs, so nested YAML, block scalars, and lists
 * are not supported. A file we cannot parse is reported as all body with no
 * frontmatter, which callers treat as "not a skill".
 */
export function parseFrontmatter(raw: string): ParsedSkillDocument {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: raw };
  }

  const lines = normalized.split("\n");
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) {
    return { frontmatter: {}, body: raw };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, closingIndex)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (key.length === 0) continue;
    frontmatter[key] = unquote(line.slice(separator + 1).trim());
  }

  const body = lines
    .slice(closingIndex + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { frontmatter, body };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/Development/paseo-skills && npx vitest run resolve/frontmatter.test.ts && npm run typecheck
```

Expected: 8 passing tests, typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/paseo-skills
git add resolve/frontmatter.ts resolve/frontmatter.test.ts
git commit -m "feat: parse SKILL.md frontmatter"
```

---

### Task 3: Codex skill resolver

Mirrors Paseo's own `listCodexSkills` (`packages/server/src/server/agent/providers/codex-app-server-agent.ts:696`) so the panel and the composer agree about what a Codex agent can see.

**Files:**
- Create: `~/Development/paseo-skills/resolve/skill-entry.ts`
- Create: `~/Development/paseo-skills/resolve/skill-directory.server.ts`
- Create: `~/Development/paseo-skills/resolve/repo-root.server.ts`
- Create: `~/Development/paseo-skills/resolve/codex.server.ts`
- Test: `~/Development/paseo-skills/resolve/repo-root.server.test.ts`
- Test: `~/Development/paseo-skills/resolve/codex.server.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from Task 2.
- Produces:
  - `interface SkillEntry { id: string; name: string; description: string; source: { kind: SkillSourceKind; label: string; dir: string }; path: string; status: "discovered" }`
  - `type SkillSourceKind = "project" | "personal" | "plugin" | "codex-home" | "codex-repo"`
  - `makeSkillId(kind: SkillSourceKind, dir: string, name: string): string`
  - `dedupeByName(entries: SkillEntry[]): SkillEntry[]`
  - `readSkillsFromDirectory(dir: string, kind: SkillSourceKind, label: string, nameFor?: (frontmatterName: string) => string): Promise<SkillEntry[]>`
  - `findRepoRoot(cwd: string): Promise<string | null>`
  - `resolveCodexSkills(options: { cwd: string; codexHome: string }): Promise<SkillEntry[]>`

- [ ] **Step 1: Write the shared entry types and directory reader**

These are shared with Task 4, so they land here rather than being duplicated. Create `~/Development/paseo-skills/resolve/skill-entry.ts`:

```ts
export type SkillSourceKind = "project" | "personal" | "plugin" | "codex-home" | "codex-repo";

export interface SkillSource {
  kind: SkillSourceKind;
  label: string;
  dir: string;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  status: "discovered";
}

export function makeSkillId(kind: SkillSourceKind, dir: string, name: string): string {
  return `${kind}:${dir}:${name}`;
}

/**
 * First name wins. Callers pass directories in precedence order, so a project
 * skill shadows a personal one of the same name without either being reported
 * twice.
 */
export function dedupeByName(entries: SkillEntry[]): SkillEntry[] {
  const byName = new Map<string, SkillEntry>();
  for (const entry of entries) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return [...byName.values()];
}
```

Create `~/Development/paseo-skills/resolve/skill-directory.server.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter";
import { makeSkillId, type SkillEntry, type SkillSourceKind } from "./skill-entry";

/**
 * Scans one `skills` directory. Each direct child directory (or symlink to one)
 * holding a SKILL.md is a skill. A missing directory is normal, not an error.
 * An entry whose frontmatter lacks name or description is skipped, matching the
 * providers — listing it would show a skill the agent cannot actually see.
 */
export async function readSkillsFromDirectory(
  dir: string,
  kind: SkillSourceKind,
  label: string,
  nameFor: (frontmatterName: string) => string = (name) => name,
): Promise<SkillEntry[]> {
  let dirEntries;
  try {
    dirEntries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = dirEntries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
  const results = await Promise.all(
    candidates.map(async (entry): Promise<SkillEntry | null> => {
      const skillPath = path.join(dir, entry.name, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(skillPath, "utf8");
      } catch {
        return null;
      }
      const { frontmatter } = parseFrontmatter(raw);
      const rawName = frontmatter.name;
      const description = frontmatter.description;
      if (!rawName || !description) return null;
      const name = nameFor(rawName);
      return {
        id: makeSkillId(kind, dir, name),
        name,
        description,
        source: { kind, label, dir },
        path: skillPath,
        status: "discovered",
      };
    }),
  );

  return results
    .filter((entry): entry is SkillEntry => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 2: Write the failing Codex resolver tests**

Create `~/Development/paseo-skills/resolve/codex.server.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { resolveCodexSkills } from "./codex.server";

let root: string;

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`,
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-codex-"));
});

describe("resolveCodexSkills", () => {
  test("finds a skill in the working directory", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".codex", "skills"), "deploy", "Deploys the app");

    const skills = await resolveCodexSkills({ cwd, codexHome: path.join(root, "codex-home") });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("deploy");
    expect(skills[0]?.description).toBe("Deploys the app");
    expect(skills[0]?.source.kind).toBe("project");
    expect(skills[0]?.path).toBe(path.join(cwd, ".codex", "skills", "deploy", "SKILL.md"));
    expect(skills[0]?.status).toBe("discovered");
  });

  test("finds a skill in the codex home directory", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    const codexHome = path.join(root, "codex-home");
    await writeSkill(path.join(codexHome, "skills"), "review", "Reviews code");

    const skills = await resolveCodexSkills({ cwd, codexHome });

    expect(skills.map((skill) => skill.name)).toEqual(["review"]);
    expect(skills[0]?.source.kind).toBe("codex-home");
  });

  test("the working directory wins a name collision with codex home", async () => {
    const cwd = path.join(root, "work");
    const codexHome = path.join(root, "codex-home");
    await writeSkill(path.join(cwd, ".codex", "skills"), "deploy", "Local version");
    await writeSkill(path.join(codexHome, "skills"), "deploy", "Home version");

    const skills = await resolveCodexSkills({ cwd, codexHome });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("Local version");
  });

  test("includes the repository root when the working directory is inside a repo", async () => {
    const repo = path.join(root, "repo");
    const cwd = path.join(repo, "packages", "app");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(repo, ".codex", "skills"), "release", "Cuts a release");

    const skills = await resolveCodexSkills({ cwd, codexHome: path.join(root, "codex-home") });

    expect(skills.map((skill) => skill.name)).toEqual(["release"]);
    expect(skills[0]?.source.kind).toBe("codex-repo");
  });

  test("skips an entry whose frontmatter has no description", async () => {
    const cwd = path.join(root, "work");
    const skillDir = path.join(cwd, ".codex", "skills", "broken");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: broken\n---\nbody\n", "utf8");

    const skills = await resolveCodexSkills({ cwd, codexHome: path.join(root, "codex-home") });

    expect(skills).toEqual([]);
  });

  test("returns an empty list when nothing exists", async () => {
    const skills = await resolveCodexSkills({
      cwd: path.join(root, "missing"),
      codexHome: path.join(root, "also-missing"),
    });

    expect(skills).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd ~/Development/paseo-skills && npx vitest run resolve/codex.server.test.ts
```

Expected: FAIL — cannot resolve `./codex.server`.

- [ ] **Step 4: Write the failing repo-root tests**

Create `~/Development/paseo-skills/resolve/repo-root.server.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { findRepoRoot } from "./repo-root.server";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-repo-"));
});

describe("findRepoRoot", () => {
  test("finds the root from a nested directory", async () => {
    const repo = path.join(root, "repo");
    const nested = path.join(repo, "packages", "app", "src");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(nested, { recursive: true });

    expect(await findRepoRoot(nested)).toBe(repo);
  });

  test("matches a .git file, so worktrees and submodules resolve", async () => {
    const repo = path.join(root, "worktree");
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, ".git"), "gitdir: /elsewhere\n", "utf8");

    expect(await findRepoRoot(repo)).toBe(repo);
  });

  test("returns null and stops at the filesystem root when there is no repo", async () => {
    const plain = path.join(root, "no-repo", "deep");
    await mkdir(plain, { recursive: true });

    expect(await findRepoRoot(plain)).toBeNull();
  });
});
```

Note: this test asserts the walk terminates. If `findRepoRoot` fails to stop at the filesystem root it will loop forever, and vitest will fail the test on its timeout rather than hanging the suite.

- [ ] **Step 5: Run the repo-root tests to verify they fail**

```bash
cd ~/Development/paseo-skills && npx vitest run resolve/repo-root.server.test.ts
```

Expected: FAIL — cannot resolve `./repo-root.server`.

- [ ] **Step 6: Write the repo-root helper**

The plugin has no access to Paseo's `WorkspaceGitService`, so walk up for `.git`. Create `~/Development/paseo-skills/resolve/repo-root.server.ts`:

```ts
import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * Walks up from cwd looking for a `.git` entry. Matches a file as well as a
 * directory so worktrees and submodules resolve. Stops at the filesystem root.
 */
export async function findRepoRoot(cwd: string): Promise<string | null> {
  let current = path.resolve(cwd);
  for (;;) {
    try {
      await stat(path.join(current, ".git"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}
```

- [ ] **Step 7: Write the Codex resolver**

Create `~/Development/paseo-skills/resolve/codex.server.ts`:

```ts
import path from "node:path";

import { findRepoRoot } from "./repo-root.server";
import { readSkillsFromDirectory } from "./skill-directory.server";
import { dedupeByName, type SkillEntry } from "./skill-entry";

export interface CodexResolveOptions {
  cwd: string;
  codexHome: string;
}

/**
 * Mirrors Paseo's own listCodexSkills so this panel and the composer agree.
 * Directories are searched in precedence order and the first name wins.
 */
export async function resolveCodexSkills(options: CodexResolveOptions): Promise<SkillEntry[]> {
  const repoRoot = await findRepoRoot(options.cwd);
  const groups: Array<Promise<SkillEntry[]>> = [
    readSkillsFromDirectory(path.join(options.cwd, ".codex", "skills"), "project", "Project"),
  ];

  if (repoRoot) {
    groups.push(
      readSkillsFromDirectory(
        path.join(path.dirname(options.cwd), ".codex", "skills"),
        "codex-repo",
        "Repository",
      ),
      readSkillsFromDirectory(path.join(repoRoot, ".codex", "skills"), "codex-repo", "Repository"),
    );
  }

  groups.push(
    readSkillsFromDirectory(path.join(options.codexHome, "skills"), "codex-home", "Codex home"),
  );

  const resolved = await Promise.all(groups);
  return dedupeByName(resolved.flat());
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd ~/Development/paseo-skills && npx vitest run resolve/ && npm run typecheck
```

Expected: 9 passing tests (6 codex, 3 repo-root) plus the 8 frontmatter tests, typecheck exit 0.

- [ ] **Step 9: Commit**

```bash
cd ~/Development/paseo-skills
git add resolve/
git commit -m "feat: resolve codex skills from workspace, repo, and codex home"
```

---

### Task 4: Claude skill resolver

The fiddly one. Claude's plugin skills live in a cache that keeps every version ever fetched, so the manifest — not the directory listing — decides what is live.

**Files:**
- Create: `~/Development/paseo-skills/resolve/claude.server.ts`
- Test: `~/Development/paseo-skills/resolve/claude.server.test.ts`

**Interfaces:**
- Consumes: `readSkillsFromDirectory`, `dedupeByName`, `SkillEntry` from Task 3.
- Produces: `resolveClaudeSkills(options: { cwd: string; claudeHome: string }): Promise<SkillEntry[]>`

- [ ] **Step 1: Write the failing tests**

Create `~/Development/paseo-skills/resolve/claude.server.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { resolveClaudeSkills } from "./claude.server";

let root: string;
let claudeHome: string;

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`,
    "utf8",
  );
}

async function writeManifest(plugins: unknown): Promise<void> {
  const pluginsDir = path.join(claudeHome, "plugins");
  await mkdir(pluginsDir, { recursive: true });
  await writeFile(
    path.join(pluginsDir, "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins }, null, 2),
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-claude-"));
  claudeHome = path.join(root, "claude-home");
});

describe("resolveClaudeSkills", () => {
  test("finds project and personal skills and labels their source", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    await writeSkill(path.join(claudeHome, "skills"), "paseo", "Operates Paseo");

    const skills = await resolveClaudeSkills({ cwd, claudeHome });

    expect(skills.map((skill) => skill.name).sort()).toEqual(["catchup", "paseo"]);
    const catchup = skills.find((skill) => skill.name === "catchup");
    const paseo = skills.find((skill) => skill.name === "paseo");
    expect(catchup?.source.kind).toBe("project");
    expect(catchup?.source.label).toBe("Project");
    expect(paseo?.source.kind).toBe("personal");
    expect(paseo?.source.label).toBe("Personal");
  });

  test("a project skill wins a name collision with a personal skill", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "review", "Project version");
    await writeSkill(path.join(claudeHome, "skills"), "review", "Personal version");

    const skills = await resolveClaudeSkills({ cwd, claudeHome });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("Project version");
    expect(skills[0]?.source.kind).toBe("project");
  });

  test("names plugin skills plugin:skill and labels them with the plugin name", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    const installPath = path.join(claudeHome, "plugins", "cache", "official", "superpowers", "6.3.0");
    await writeSkill(path.join(installPath, "skills"), "brainstorming", "Turns ideas into designs");
    await writeManifest({
      "superpowers@official": [{ scope: "local", installPath, version: "6.3.0" }],
    });

    const skills = await resolveClaudeSkills({ cwd, claudeHome });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("superpowers:brainstorming");
    expect(skills[0]?.source.kind).toBe("plugin");
    expect(skills[0]?.source.label).toBe("superpowers");
  });

  test("ignores cached plugin versions the manifest does not list", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    const cache = path.join(claudeHome, "plugins", "cache", "official", "superpowers");
    const live = path.join(cache, "6.3.0");
    const stale = path.join(cache, "6.1.1");
    await writeSkill(path.join(live, "skills"), "brainstorming", "Current");
    await writeSkill(path.join(stale, "skills"), "brainstorming", "Outdated");
    await writeManifest({
      "superpowers@official": [{ scope: "local", installPath: live, version: "6.3.0" }],
    });

    const skills = await resolveClaudeSkills({ cwd, claudeHome });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("Current");
  });

  test("excludes a project-scoped plugin when the agent works elsewhere", async () => {
    const cwd = path.join(root, "other-project");
    await mkdir(cwd, { recursive: true });
    const installPath = path.join(claudeHome, "plugins", "cache", "market", "plugin-b", "1.0.0");
    await writeSkill(path.join(installPath, "skills"), "expert", "SwiftUI help");
    await writeManifest({
      "plugin-b@market": [
        { scope: "project", projectPath: path.join(root, "swift-project"), installPath, version: "1.0.0" },
      ],
    });

    const skills = await resolveClaudeSkills({ cwd, claudeHome });

    expect(skills).toEqual([]);
  });

  test("includes a project-scoped plugin when the agent works inside its project", async () => {
    const projectPath = path.join(root, "swift-project");
    const cwd = path.join(projectPath, "Sources");
    await mkdir(cwd, { recursive: true });
    const installPath = path.join(claudeHome, "plugins", "cache", "market", "plugin-b", "1.0.0");
    await writeSkill(path.join(installPath, "skills"), "expert", "SwiftUI help");
    await writeManifest({
      "plugin-b@market": [{ scope: "project", projectPath, installPath, version: "1.0.0" }],
    });

    const skills = await resolveClaudeSkills({ cwd, claudeHome });

    expect(skills.map((skill) => skill.name)).toEqual(["plugin-b:expert"]);
  });

  test("keeps project and personal skills when the manifest is missing", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");

    const skills = await resolveClaudeSkills({ cwd, claudeHome });

    expect(skills.map((skill) => skill.name)).toEqual(["catchup"]);
  });

  test("keeps project and personal skills when the manifest is malformed", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    const pluginsDir = path.join(claudeHome, "plugins");
    await mkdir(pluginsDir, { recursive: true });
    await writeFile(path.join(pluginsDir, "installed_plugins.json"), "{ not json", "utf8");

    const skills = await resolveClaudeSkills({ cwd, claudeHome });

    expect(skills.map((skill) => skill.name)).toEqual(["catchup"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ~/Development/paseo-skills && npx vitest run resolve/claude.server.test.ts
```

Expected: FAIL — cannot resolve `./claude.server`.

- [ ] **Step 3: Write the implementation**

Create `~/Development/paseo-skills/resolve/claude.server.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

import { readSkillsFromDirectory } from "./skill-directory.server";
import { dedupeByName, type SkillEntry } from "./skill-entry";

export interface ClaudeResolveOptions {
  cwd: string;
  claudeHome: string;
}

interface InstalledPluginEntry {
  scope?: string;
  projectPath?: string;
  installPath?: string;
}

function isInside(child: string, parent: string): boolean {
  const normalizedChild = path.resolve(child);
  const normalizedParent = path.resolve(parent);
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent}${path.sep}`)
  );
}

/**
 * The plugin cache keeps every version ever fetched, so the directory listing
 * cannot tell you what is live. installed_plugins.json can: each entry names the
 * exact installPath in use. A project-scoped entry applies only inside its own
 * projectPath; local and user scopes apply everywhere.
 */
async function readInstalledPluginDirs(
  claudeHome: string,
  cwd: string,
): Promise<Array<{ pluginName: string; dir: string }>> {
  const manifestPath = path.join(claudeHome, "plugins", "installed_plugins.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return [];
  }

  const plugins = (parsed as { plugins?: Record<string, unknown> } | null)?.plugins;
  if (!plugins || typeof plugins !== "object") return [];

  const results: Array<{ pluginName: string; dir: string }> = [];
  for (const [key, value] of Object.entries(plugins)) {
    if (!Array.isArray(value)) continue;
    const pluginName = key.split("@")[0] ?? key;
    for (const entry of value as InstalledPluginEntry[]) {
      if (!entry || typeof entry.installPath !== "string") continue;
      if (entry.scope === "project") {
        if (typeof entry.projectPath !== "string" || !isInside(cwd, entry.projectPath)) continue;
      }
      results.push({ pluginName, dir: path.join(entry.installPath, "skills") });
    }
  }
  return results;
}

/**
 * Precedence: project, then personal, then plugins. Plugin skills are namespaced
 * `plugin:skill`, so in practice they never collide with the first two.
 */
export async function resolveClaudeSkills(options: ClaudeResolveOptions): Promise<SkillEntry[]> {
  const pluginDirs = await readInstalledPluginDirs(options.claudeHome, options.cwd);

  const resolved = await Promise.all([
    readSkillsFromDirectory(path.join(options.cwd, ".claude", "skills"), "project", "Project"),
    readSkillsFromDirectory(path.join(options.claudeHome, "skills"), "personal", "Personal"),
    ...pluginDirs.map(({ pluginName, dir }) =>
      readSkillsFromDirectory(dir, "plugin", pluginName, (name) => `${pluginName}:${name}`),
    ),
  ]);

  return dedupeByName(resolved.flat());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd ~/Development/paseo-skills && npx vitest run resolve/claude.server.test.ts && npm run typecheck
```

Expected: 8 passing tests, typecheck exit 0.

- [ ] **Step 5: Verify against the real machine**

The fixtures prove the rules; this proves the rules match reality. Create a temporary test file `~/Development/paseo-skills/resolve/real-machine.tmp.test.ts`:

```ts
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { resolveClaudeSkills } from "./claude.server";

test("resolves this machine's real claude skills without duplicates", async () => {
  const skills = await resolveClaudeSkills({
    cwd: path.join(os.homedir(), "Development", "paseo"),
    claudeHome: path.join(os.homedir(), ".claude"),
  });

  for (const skill of skills) {
    console.log(`${skill.source.label.padEnd(24)} ${skill.name}`);
  }

  const names = skills.map((skill) => skill.name);
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toContain("superpowers:brainstorming");
});
```

```bash
cd ~/Development/paseo-skills && npx vitest run resolve/real-machine.tmp.test.ts
```

Expected: PASS, with the logged list showing `superpowers:brainstorming` exactly once rather than once per cached version, `Personal` skills from `~/.claude/skills`, and no `plugin-b` or `plugin-c` entries — those are project-scoped to a different repository.

Delete the temporary test; it asserts facts about one machine and does not belong in the suite:

```bash
rm ~/Development/paseo-skills/resolve/real-machine.tmp.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd ~/Development/paseo-skills
git add resolve/claude.server.ts resolve/claude.server.test.ts
git commit -m "feat: resolve claude project, personal, and plugin skills"
```

---

### Task 5: RPC contracts and handlers

Wires the resolvers to the agent. The handler resolves `provider` and `cwd` itself rather than trusting the client, and `skills.read` accepts an id rather than a path so no arbitrary-file-read RPC exists.

**Files:**
- Create: `~/Development/paseo-skills/skills.shared.ts`
- Create: `~/Development/paseo-skills/skills.server.ts`
- Test: `~/Development/paseo-skills/skills.server.test.ts`

**Interfaces:**
- Consumes: `resolveClaudeSkills` (Task 4), `resolveCodexSkills` (Task 3), `SkillEntry` (Task 3).
- Produces:
  - `listSkills` and `readSkill` RPC contracts, imported by Task 6's client and by `index.ts`.
  - `createListSkillsHandler(roots?: SkillRoots)` and `createReadSkillHandler(roots?: SkillRoots)`.
  - `interface SkillRoots { claudeHome: string; codexHome: string }`

- [ ] **Step 1: Write the shared contracts**

Create `~/Development/paseo-skills/skills.shared.ts`:

```ts
import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const SkillSourceSchema = z.object({
  kind: z.enum(["project", "personal", "plugin", "codex-home", "codex-repo"]),
  label: z.string(),
  dir: z.string(),
});

export const SkillEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: SkillSourceSchema,
  path: z.string(),
  status: z.enum(["discovered"]),
});

export const listSkills = defineRpc({
  name: "skills.list",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    provider: z.string(),
    supported: z.boolean(),
    cwd: z.string().nullable(),
    skills: z.array(SkillEntrySchema),
  }),
});

export const readSkill = defineRpc({
  name: "skills.read",
  input: z.object({ agentId: z.string(), skillId: z.string() }),
  output: z.object({
    name: z.string(),
    description: z.string(),
    path: z.string(),
    body: z.string(),
  }),
});
```

- [ ] **Step 2: Write the failing handler tests**

Create `~/Development/paseo-skills/skills.server.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { beforeEach, describe, expect, test } from "vitest";

import {
  createListSkillsHandler,
  createReadSkillHandler,
  defaultSkillRoots,
  type SkillRoots,
} from "./skills.server";

let root: string;
let roots: SkillRoots;

function contextFor(agent: { id: string; provider: string; cwd: string } | null) {
  const handle = {
    refresh: async () => (agent ? { agent, project: null } : null),
    current: () => agent,
  };
  return { paseo: { agents: { ref: () => handle } } } as unknown as PluginHandlerContext;
}

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`,
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paseo-skills-handler-"));
  roots = {
    claudeHome: path.join(root, "claude-home"),
    codexHome: path.join(root, "codex-home"),
  };
});

describe("createListSkillsHandler", () => {
  test("lists claude skills for a claude agent", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "claude", cwd }),
    );

    expect(result.supported).toBe(true);
    expect(result.provider).toBe("claude");
    expect(result.cwd).toBe(cwd);
    expect(result.skills.map((skill) => skill.name)).toEqual(["catchup"]);
  });

  test("lists codex skills for a codex agent", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".codex", "skills"), "deploy", "Deploys the app");
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "codex", cwd }),
    );

    expect(result.skills.map((skill) => skill.name)).toEqual(["deploy"]);
  });

  test("reports an unsupported provider instead of an empty list", async () => {
    const handler = createListSkillsHandler(roots);

    const result = await handler(
      { agentId: "agent-1" },
      contextFor({ id: "agent-1", provider: "opencode", cwd: root }),
    );

    expect(result.supported).toBe(false);
    expect(result.provider).toBe("opencode");
    expect(result.skills).toEqual([]);
  });

  test("throws when the agent cannot be found", async () => {
    const handler = createListSkillsHandler(roots);

    await expect(handler({ agentId: "missing" }, contextFor(null))).rejects.toThrow(
      /missing/,
    );
  });
});

describe("defaultSkillRoots", () => {
  test("honors CODEX_HOME", () => {
    const roots = defaultSkillRoots({ CODEX_HOME: "/custom/codex" } as NodeJS.ProcessEnv);
    expect(roots.codexHome).toBe("/custom/codex");
  });

  test("falls back to ~/.codex and always uses ~/.claude", () => {
    const roots = defaultSkillRoots({} as NodeJS.ProcessEnv);
    expect(roots.codexHome).toBe(path.join(os.homedir(), ".codex"));
    expect(roots.claudeHome).toBe(path.join(os.homedir(), ".claude"));
  });
});

describe("createReadSkillHandler", () => {
  test("returns the body for a discovered skill", async () => {
    const cwd = path.join(root, "work");
    await writeSkill(path.join(cwd, ".claude", "skills"), "catchup", "Summarizes changes");
    const context = contextFor({ id: "agent-1", provider: "claude", cwd });
    const listed = await createListSkillsHandler(roots)({ agentId: "agent-1" }, context);
    const skillId = listed.skills[0]!.id;

    const result = await createReadSkillHandler(roots)({ agentId: "agent-1", skillId }, context);

    expect(result.name).toBe("catchup");
    expect(result.description).toBe("Summarizes changes");
    expect(result.path).toBe(path.join(cwd, ".claude", "skills", "catchup", "SKILL.md"));
    expect(result.body).toBe("Body for catchup.\n");
  });

  test("throws for a skill id discovery does not return", async () => {
    const cwd = path.join(root, "work");
    await mkdir(cwd, { recursive: true });
    const context = contextFor({ id: "agent-1", provider: "claude", cwd });

    await expect(
      createReadSkillHandler(roots)(
        { agentId: "agent-1", skillId: "project:/etc:passwd" },
        context,
      ),
    ).rejects.toThrow(/not available/);
  });
});
```

The last test is the one that matters for safety: an id the resolver never produced must not read a file.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd ~/Development/paseo-skills && npx vitest run skills.server.test.ts
```

Expected: FAIL — cannot resolve `./skills.server`.

- [ ] **Step 4: Write the handlers**

Create `~/Development/paseo-skills/skills.server.ts`:

```ts
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PluginHandlerContext } from "@getpaseo/plugin/server";

import { parseFrontmatter } from "./resolve/frontmatter";
import { resolveClaudeSkills } from "./resolve/claude.server";
import { resolveCodexSkills } from "./resolve/codex.server";
import type { SkillEntry } from "./resolve/skill-entry";

export interface SkillRoots {
  claudeHome: string;
  codexHome: string;
}

export function defaultSkillRoots(env: NodeJS.ProcessEnv = process.env): SkillRoots {
  const home = os.homedir();
  return {
    claudeHome: path.join(home, ".claude"),
    codexHome: env.CODEX_HOME ?? path.join(home, ".codex"),
  };
}

interface ResolvedAgent {
  provider: string;
  cwd: string;
}

async function loadAgent(agentId: string, context: PluginHandlerContext): Promise<ResolvedAgent> {
  const handle = context.paseo.agents.ref(agentId);
  const refreshed = await handle.refresh();
  const agent = refreshed?.agent ?? handle.current();
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return { provider: agent.provider, cwd: agent.cwd };
}

async function resolveForAgent(agent: ResolvedAgent, roots: SkillRoots): Promise<SkillEntry[]> {
  if (agent.provider === "claude") {
    return resolveClaudeSkills({ cwd: agent.cwd, claudeHome: roots.claudeHome });
  }
  if (agent.provider === "codex") {
    return resolveCodexSkills({ cwd: agent.cwd, codexHome: roots.codexHome });
  }
  return [];
}

function isSupported(provider: string): boolean {
  return provider === "claude" || provider === "codex";
}

export function createListSkillsHandler(roots: SkillRoots = defaultSkillRoots()) {
  return async (input: { agentId: string }, context: PluginHandlerContext) => {
    const agent = await loadAgent(input.agentId, context);
    return {
      provider: agent.provider,
      supported: isSupported(agent.provider),
      cwd: agent.cwd,
      skills: await resolveForAgent(agent, roots),
    };
  };
}

/**
 * Takes a skill id, never a path. Discovery runs again and the id is looked up
 * in its result, so the only readable files are ones discovery already found.
 */
export function createReadSkillHandler(roots: SkillRoots = defaultSkillRoots()) {
  return async (input: { agentId: string; skillId: string }, context: PluginHandlerContext) => {
    const agent = await loadAgent(input.agentId, context);
    const skills = await resolveForAgent(agent, roots);
    const skill = skills.find((entry) => entry.id === input.skillId);
    if (!skill) {
      throw new Error(`Skill is no longer available: ${input.skillId}`);
    }
    const raw = await readFile(skill.path, "utf8");
    return {
      name: skill.name,
      description: skill.description,
      path: skill.path,
      body: parseFrontmatter(raw).body,
    };
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd ~/Development/paseo-skills && npx vitest run skills.server.test.ts && npm run typecheck
```

Expected: 8 passing tests, typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
cd ~/Development/paseo-skills
git add skills.shared.ts skills.server.ts skills.server.test.ts
git commit -m "feat: add skills.list and skills.read plugin RPCs"
```

---

### Task 6: The panel's list view, and wiring

Replaces the scaffold's greeting surface with the real contributions. Ends with a working, searchable list you can open from the Command Center.

**Files:**
- Create: `~/Development/paseo-skills/panel.client.tsx`
- Modify: `~/Development/paseo-skills/index.ts` (replace entirely)
- Delete: `~/Development/paseo-skills/main.client.tsx`

**Interfaces:**
- Consumes: `listSkills`, `readSkill` (Task 5), `createListSkillsHandler`, `createReadSkillHandler` (Task 5).
- Produces: `SkillsPanel` component; panel id `skills`; Command Center item id `open-skills`.

- [ ] **Step 1: Write the panel's list view**

There is no test harness for plugin UI, so this task is verified by hand in the app. Create `~/Development/paseo-skills/panel.client.tsx`:

```tsx
import { type PluginAgentPanelProps, useAgent, useRpc } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { z } from "zod";

import { listSkills, SkillEntrySchema } from "./skills.shared";

type Skill = z.infer<typeof SkillEntrySchema>;

// Menlo does not exist on Android, where an unknown family silently falls back
// to the default proportional font.
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

function groupBySource(skills: Skill[]): Array<{ label: string; skills: Skill[] }> {
  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    const existing = groups.get(skill.source.label);
    if (existing) existing.push(skill);
    else groups.set(skill.source.label, [skill]);
  }
  return [...groups].map(([label, entries]) => ({ label, skills: entries }));
}

export function SkillsPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const agent = useAgent(agentId, (snapshot) => ({
    provider: snapshot.provider,
    cwd: snapshot.cwd,
  }));
  const callListSkills = useRpc(listSkills);
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["skills", agentId, agent?.cwd],
    queryFn: () => callListSkills({ agentId }),
  });

  const padding = layout.compact ? 12 : 20;
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding },
      search: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: padding,
      },
      groupLabel: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        textTransform: "uppercase" as const,
        marginTop: padding,
        marginBottom: 6,
      },
      row: { paddingVertical: 10 },
      name: { color: theme.colors.foreground, fontSize: 15 },
      description: { color: theme.colors.foregroundMuted, fontSize: 13, marginTop: 2 },
      message: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
    }),
    [theme, padding],
  );

  const filtered = useMemo(() => {
    const skills = query.data?.skills ?? [];
    const term = search.trim().toLowerCase();
    if (term.length === 0) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(term) ||
        skill.description.toLowerCase().includes(term),
    );
  }, [query.data, search]);

  if (query.isPending) {
    return (
      <View style={[styles.screen, { padding }]}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={[styles.screen, { padding }]}>
        <Text style={styles.error}>{(query.error as Error).message}</Text>
      </View>
    );
  }

  if (!query.data?.supported) {
    return (
      <View style={[styles.screen, { padding }]}>
        <Text style={styles.message}>
          {query.data?.provider ?? "This provider"} does not support skills.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search skills"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {filtered.length === 0 ? (
        <Text style={styles.message}>
          {search.trim().length > 0 ? "No skills match that search." : "No skills found."}
        </Text>
      ) : (
        groupBySource(filtered).map((group) => (
          <View key={group.label}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {group.skills.map((skill) => (
              <Pressable key={skill.id} style={styles.row}>
                <Text style={styles.name}>{skill.name}</Text>
                <Text style={styles.description} numberOfLines={2}>
                  {skill.description}
                </Text>
              </Pressable>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}
```

The rows are not pressable yet — Task 7 adds the detail view behind them.

- [ ] **Step 2: Replace the entry point**

Overwrite `~/Development/paseo-skills/index.ts` with:

```ts
import type { PluginContext } from "@getpaseo/plugin";

import { SkillsPanel } from "./panel.client";
import { createListSkillsHandler, createReadSkillHandler } from "./skills.server";
import { listSkills, readSkill } from "./skills.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listSkills, createListSkillsHandler());
  plugin.handle(readSkill, createReadSkillHandler());
  plugin.addWorkspacePanel({
    id: "skills",
    title: "Skills",
    icon: "Sparkles",
    context: "agent",
    Component: SkillsPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-skills",
    title: "Skills",
    icon: "Sparkles",
    keywords: ["skill", "skills", "agent skills"],
    context: "agent",
    onSelect: ({ openPanel }) => {
      openPanel("skills");
    },
  });
  return () => {};
}
```

Then delete the scaffold's surface, which nothing imports any more:

```bash
rm ~/Development/paseo-skills/main.client.tsx
```

- [ ] **Step 3: Typecheck and run the full test suite**

```bash
cd ~/Development/paseo-skills && npm run typecheck && npm test
```

Expected: typecheck exit 0, all tests from Tasks 2-5 passing.

- [ ] **Step 4: Reload the plugin and check for load errors**

```bash
paseo plugin reload skills
paseo plugin logs skills
```

Expected: loading and ready entries, no compilation errors. A failed reload stays failed — Paseo does not restore the old code, so fix any error before continuing.

- [ ] **Step 5: Verify in the app**

In the Paseo app, focus a workspace tab holding a **Claude** agent, then press ⌘K (Ctrl+K on Windows/Linux) and search for "Skills". Selecting it opens the panel as a workspace tab.

Confirm:
- The panel also appears wherever the workspace offers new tabs, if that surface lists plugin panels. If it does not, the Command Center is the only entry point — note that in the README rather than treating it as a bug.
- Skills appear grouped under `Project`, `Personal`, and one group per plugin.
- `superpowers:brainstorming` appears exactly once, not once per cached version.
- Typing in the search box filters by both name and description.
- Repeat with a **Codex** agent: groups are `Project`, `Repository`, `Codex home`.
- Repeat with an **OpenCode** agent: the panel says the provider does not support skills.

- [ ] **Step 6: Commit**

```bash
cd ~/Development/paseo-skills
git add -A
git commit -m "feat: contribute agent skills panel and command center item"
```

---

### Task 7: Skill detail — body, path, and invoke

**Files:**
- Modify: `~/Development/paseo-skills/panel.client.tsx`

**Interfaces:**
- Consumes: `readSkill` (Task 5), `SkillsPanel` (Task 6).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Add the detail component**

First update the file's two import lines so the detail view can reach the Paseo API and the read contract. Replace:

```tsx
import { type PluginAgentPanelProps, useAgent, useRpc } from "@getpaseo/plugin";
```

with:

```tsx
import { type PluginAgentPanelProps, useAgent, usePaseo, useRpc } from "@getpaseo/plugin";
```

and replace:

```tsx
import { listSkills, SkillEntrySchema } from "./skills.shared";
```

with:

```tsx
import { listSkills, readSkill, SkillEntrySchema } from "./skills.shared";
```

Then add the following above `SkillsPanel`:

```tsx
function copyToClipboard(value: string): boolean {
  // React Native dropped Clipboard from core and no clipboard package is
  // available to plugins, so web and desktop copy via the DOM and native falls
  // back to selectable text.
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(value);
    return true;
  }
  return false;
}

function SkillDetail({
  theme,
  layout,
  agentId,
  skillId,
  onBack,
}: {
  theme: PluginAgentPanelProps["theme"];
  layout: PluginAgentPanelProps["layout"];
  agentId: string;
  skillId: string;
  onBack: () => void;
}) {
  const callReadSkill = useRpc(readSkill);
  const paseo = usePaseo();
  const [args, setArgs] = useState("");
  const [copied, setCopied] = useState(false);
  const [invokeError, setInvokeError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["skill", agentId, skillId],
    queryFn: () => callReadSkill({ agentId, skillId }),
  });

  const padding = layout.compact ? 12 : 20;
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding },
      back: { color: theme.colors.accent, marginBottom: padding },
      name: { color: theme.colors.foreground, fontSize: 18, marginBottom: 4 },
      description: { color: theme.colors.foregroundMuted, marginBottom: padding },
      path: { color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: MONO },
      copy: { color: theme.colors.accent, marginTop: 4, marginBottom: padding },
      argsInput: {
        color: theme.colors.foreground,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 8,
      },
      invoke: {
        backgroundColor: theme.colors.accent,
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: "center" as const,
        marginBottom: padding,
      },
      invokeLabel: { color: theme.colors.accentForeground, fontSize: 15 },
      body: { color: theme.colors.foreground, fontFamily: MONO, fontSize: 12 },
      error: { color: theme.colors.statusDanger, marginBottom: padding },
    }),
    [theme, padding],
  );

  async function invoke(name: string) {
    setInvokeError(null);
    const trimmed = args.trim();
    try {
      await paseo.agents.ref(agentId).send(trimmed ? `/${name} ${trimmed}` : `/${name}`);
      onBack();
    } catch (error) {
      setInvokeError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← All skills</Text>
      </Pressable>
      {query.isPending ? (
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      ) : query.isError ? (
        <Text style={styles.error}>{(query.error as Error).message}</Text>
      ) : (
        <>
          <Text style={styles.name}>{query.data.name}</Text>
          <Text style={styles.description}>{query.data.description}</Text>
          <Text style={styles.path} selectable>
            {query.data.path}
          </Text>
          <Pressable
            onPress={() => {
              setCopied(copyToClipboard(query.data.path));
            }}
          >
            <Text style={styles.copy}>{copied ? "Copied" : "Copy path"}</Text>
          </Pressable>
          <TextInput
            style={styles.argsInput}
            value={args}
            onChangeText={setArgs}
            placeholder="Arguments (optional)"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCorrect={false}
          />
          {invokeError ? <Text style={styles.error}>{invokeError}</Text> : null}
          <Pressable style={styles.invoke} onPress={() => void invoke(query.data.name)}>
            <Text style={styles.invokeLabel}>Invoke</Text>
          </Pressable>
          <Text style={styles.body}>{query.data.body}</Text>
        </>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Route the list rows into the detail view**

In `SkillsPanel`, add selection state directly after the existing `const [search, setSearch] = useState("");`:

```tsx
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
```

Add this immediately before the `if (query.isPending)` guard, so a selected skill takes over the panel:

```tsx
  if (selectedSkillId) {
    return (
      <SkillDetail
        theme={theme}
        layout={layout}
        agentId={agentId}
        skillId={selectedSkillId}
        onBack={() => setSelectedSkillId(null)}
      />
    );
  }
```

Then give the row an `onPress`, replacing the existing `<Pressable key={skill.id} style={styles.row}>` opening tag with:

```tsx
              <Pressable
                key={skill.id}
                style={styles.row}
                onPress={() => setSelectedSkillId(skill.id)}
              >
```

- [ ] **Step 3: Typecheck and run the tests**

```bash
cd ~/Development/paseo-skills && npm run typecheck && npm test
```

Expected: typecheck exit 0, all tests passing.

- [ ] **Step 4: Reload and verify in the app**

```bash
paseo plugin reload skills
paseo plugin logs skills
```

In the app, with a **Claude** agent's panel open:
- Tap a skill. The detail shows its name, description, absolute path, and full body.
- "Copy path" reports "Copied" on desktop/web. On native the path is long-pressable instead.
- Tap **Invoke** with no arguments. The panel returns to the list and the agent receives the slash invocation — check the agent's transcript to confirm the skill actually ran rather than the text `/name` appearing literally.
- Invoke a skill with arguments typed into the field and confirm they reach the agent.
- Repeat the invoke check with a **Codex** agent, which takes a different path through the daemon (the slash resolves into a skill content block).

- [ ] **Step 5: Commit**

```bash
cd ~/Development/paseo-skills
git add panel.client.tsx
git commit -m "feat: read and invoke a skill from the panel"
```

---

### Task 8: Document the plugin and move the design docs home

**Files:**
- Create: `~/Development/paseo-skills/README.md`
- Create: `~/Development/paseo-skills/docs/design.md` (moved)
- Create: `~/Development/paseo-skills/docs/plan.md` (moved)
- Delete: `~/Development/paseo/docs/superpowers/specs/2026-08-20-agent-skills-panel-design.md`
- Delete: `~/Development/paseo/docs/superpowers/plans/2026-08-20-agent-skills-panel.md`

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Write the README**

Create `~/Development/paseo-skills/README.md`:

```markdown
# paseo-skills

A Paseo plugin that lists the agent skills available to an agent session, shows where each one
comes from, renders its `SKILL.md`, and invokes it.

Supports Claude and Codex agents. Other providers report that they have no skill support.

## Install

```bash
npm install
npm run typecheck && npm test
paseo plugin install /absolute/path/to/paseo-skills
```

The daemon needs `"pluginsEnabled": true` in its `config.json`. Run `paseo reload` after changing it.

## Use

Focus a workspace tab holding an agent, press ⌘K, and pick **Skills**.

## Develop

```bash
npm test                     # vitest, resolvers only
npm run typecheck
paseo plugin reload skills   # after any source change
paseo plugin logs skills     # load errors and stderr
```

A failed reload stays failed; Paseo does not restore the previous code.

## Layout

| File                            | Owns                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `index.ts`                      | Contribution wiring only.                                 |
| `skills.shared.ts`              | zod RPC contracts, imported by both runtimes.             |
| `skills.server.ts`              | RPC handlers; resolves the agent, dispatches by provider. |
| `resolve/claude.server.ts`      | Claude project, personal, and plugin skills.              |
| `resolve/codex.server.ts`       | Codex workspace, repository, and home skills.             |
| `resolve/skill-directory.server.ts` | Scans one `skills` directory.                         |
| `resolve/frontmatter.ts`        | `SKILL.md` frontmatter parsing.                           |
| `panel.client.tsx`              | The panel: list, search, detail, invoke.                  |

`docs/design.md` records why it is shaped this way. Read it before changing discovery.
```

- [ ] **Step 2: Move the design and plan into the plugin repo**

They lived in the Paseo checkout only because the plugin repo did not exist yet. They were never committed there.

```bash
mkdir -p ~/Development/paseo-skills/docs
mv ~/Development/paseo/docs/superpowers/specs/2026-08-20-agent-skills-panel-design.md ~/Development/paseo-skills/docs/design.md
mv ~/Development/paseo/docs/superpowers/plans/2026-08-20-agent-skills-panel.md ~/Development/paseo-skills/docs/plan.md
```

- [ ] **Step 3: Confirm the Paseo checkout is untouched**

```bash
cd ~/Development/paseo && git status --porcelain -- ':!.superpowers'
```

Expected: no output. `.superpowers/` is excluded because it holds this execution's scratch ledger, which is deleted separately. If anything else is listed, the plugin work leaked into the Paseo repo — revert it.

- [ ] **Step 4: Final verification**

```bash
cd ~/Development/paseo-skills && npm run typecheck && npm test
```

Expected: typecheck exit 0, every test passing.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/paseo-skills
git add -A
git commit -m "docs: add readme and move design and plan into the plugin repo"
```
