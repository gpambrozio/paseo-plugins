/**
 * The first mate's home as files: listed, read and written from the panel.
 *
 * Paths are relative to the home, `/`-separated, with `""` for the home
 * itself. The daemon refuses anything that resolves outside it — `..`, an
 * absolute path, a symlink pointing elsewhere — so the panel can only ever
 * reach what the first mate can write.
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Larger files are listed but not opened: the editor is a text box, and the RPC carries the whole file. */
export const MAX_EDITABLE_BYTES = 1024 * 1024;

export const HomeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["dir", "file"]),
  size: z.number(),
  modifiedMs: z.number(),
});
export type HomeEntry = z.infer<typeof HomeEntrySchema>;

export const listHomeFiles = defineRpc({
  name: "firstmate.files.list",
  input: z.object({ path: z.string().default("") }),
  output: z.object({ home: z.string(), path: z.string(), entries: z.array(HomeEntrySchema) }),
});

export const readHomeFile = defineRpc({
  name: "firstmate.files.read",
  input: z.object({ path: z.string().min(1) }),
  output: z.object({
    path: z.string(),
    /** Null for a binary file or one over `MAX_EDITABLE_BYTES`; the flags say which. */
    content: z.string().nullable(),
    binary: z.boolean(),
    tooLarge: z.boolean(),
    size: z.number(),
    modifiedMs: z.number(),
  }),
});

/**
 * Saves a file. `expectedModifiedMs` is the modification time the editor
 * opened it at: a file changed since — the first mate writes these files too
 * — is refused unless `force`, so neither side silently loses the other's
 * edit. `null` creates a new file, and refuses one that already exists.
 */
export const writeHomeFile = defineRpc({
  name: "firstmate.files.write",
  input: z.object({
    path: z.string().min(1),
    content: z.string().max(MAX_EDITABLE_BYTES),
    expectedModifiedMs: z.number().nullable(),
    force: z.boolean().default(false),
  }),
  output: z.object({ path: z.string(), size: z.number(), modifiedMs: z.number() }),
});
