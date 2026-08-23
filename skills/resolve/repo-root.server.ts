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
