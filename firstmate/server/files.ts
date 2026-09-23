/**
 * The first mate's home as files, for the panel's file view.
 *
 * Every path is relative to the home and is checked twice: lexically (no
 * absolute paths, nothing that normalizes above the home) and on disk, by
 * resolving symlinks and requiring the result to still be inside the home's
 * own real path. The second check is what stops a link the first mate — or a
 * clone under `projects/` — happens to contain from opening the rest of the
 * disk.
 *
 * Writes carry the modification time the editor opened the file at, because
 * the first mate writes these same files; a save over a newer version is
 * refused unless forced. Each write goes to a temporary file that is then
 * renamed, so a crash never leaves half a file for the first mate to read.
 */
import { mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

import { MAX_EDITABLE_BYTES, type HomeEntry } from "../shared/files";

/** How much of a file is read to decide whether it is text. */
const SNIFF_BYTES = 8192;

/** Turns a panel path into a normalized relative one, or throws. `""` is the home. */
export function cleanRelative(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (trimmed === "" || trimmed === ".") return "";
  if (isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed)) throw new Error(`"${path}" is not a path inside the home.`);
  const normalized = normalize(trimmed).split(sep).join("/").replace(/\/+$/, "");
  if (normalized === ".." || normalized.startsWith("../")) throw new Error(`"${path}" is outside the home.`);
  return normalized === "." ? "" : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const between = relative(root, candidate);
  return between === "" || (!between.startsWith("..") && !isAbsolute(between));
}

/**
 * The absolute path for `path`, after resolving symlinks — of the path
 * itself when it exists, of its nearest existing ancestor when it does not
 * (a file about to be created) — and refusing anything that lands outside.
 */
export async function resolveInHome(home: string, path: string): Promise<{ absolute: string; relative: string }> {
  const rel = cleanRelative(path);
  const root = await realpath(home);
  const absolute = join(root, rel);
  let existing = absolute;
  for (;;) {
    try {
      const real = await realpath(existing);
      if (!isInside(root, real)) throw new Error(`"${rel}" leads outside the home.`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
  }
  return { absolute, relative: rel };
}

function childPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/** One directory, folders first, then files, each alphabetical. Entries that vanish mid-listing are skipped. */
export async function listDirectory(home: string, path: string): Promise<{ path: string; entries: HomeEntry[] }> {
  const { absolute, relative: rel } = await resolveInHome(home, path);
  const dirents = await readdir(absolute, { withFileTypes: true });
  const entries: HomeEntry[] = [];
  await Promise.all(
    dirents.map(async function (dirent) {
      const full = join(absolute, dirent.name);
      try {
        const info = await stat(full);
        if (!info.isDirectory() && !info.isFile()) return;
        entries.push({
          name: dirent.name,
          path: childPath(rel, dirent.name),
          kind: info.isDirectory() ? "dir" : "file",
          size: info.size,
          modifiedMs: Math.floor(info.mtimeMs),
        });
      } catch {
        // Gone since the listing, or a dangling link: nothing to show.
      }
    }),
  );
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  return { path: rel, entries };
}

/** A NUL byte in the first few kilobytes is the usual sign of a file that is not text. */
async function looksBinary(absolute: string): Promise<boolean> {
  const handle = await open(absolute, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

export async function readTextFile(home: string, path: string) {
  const { absolute, relative: rel } = await resolveInHome(home, path);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`"${rel}" is not a file.`);
  const base = { path: rel, size: info.size, modifiedMs: Math.floor(info.mtimeMs) };
  if (info.size > MAX_EDITABLE_BYTES) return { ...base, content: null, binary: false, tooLarge: true };
  if (await looksBinary(absolute)) return { ...base, content: null, binary: true, tooLarge: false };
  return { ...base, content: await readFile(absolute, "utf8"), binary: false, tooLarge: false };
}

export async function writeTextFile(
  home: string,
  input: { path: string; content: string; expectedModifiedMs: number | null; force: boolean },
): Promise<{ path: string; size: number; modifiedMs: number }> {
  const { absolute, relative: rel } = await resolveInHome(home, input.path);
  if (rel === "") throw new Error("The home itself is not a file.");

  let current: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    current = await stat(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current !== null && !current.isFile()) throw new Error(`"${rel}" is not a file.`);
  if (input.expectedModifiedMs === null && current !== null) {
    throw new Error(`"${rel}" already exists. Open it to edit it.`);
  }
  if (
    input.expectedModifiedMs !== null &&
    !input.force &&
    (current === null || Math.floor(current.mtimeMs) !== input.expectedModifiedMs)
  ) {
    throw new Error(
      current === null
        ? `"${rel}" was deleted since you opened it — the first mate may have removed it. Overwrite to write your version back.`
        : `"${rel}" changed since you opened it — the first mate may have written it. Reload to see that version, or overwrite it with yours.`,
    );
  }

  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.firstmate-${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temporary, input.content, "utf8");
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const saved = await stat(absolute);
  return { path: rel, size: saved.size, modifiedMs: Math.floor(saved.mtimeMs) };
}

/** The home, which a launch creates; before that there is nothing to show, and saying so beats ENOENT. */
export async function requireHome(home: string): Promise<string> {
  try {
    const info = await stat(home);
    if (info.isDirectory()) return home;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  throw new Error("The first mate's home does not exist yet. Launch the first mate, and it is created.");
}
