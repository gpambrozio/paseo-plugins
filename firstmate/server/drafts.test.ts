import { it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChatDraft, writeChatDraft, chatDraftFile } from "./drafts";

it("persists text and clears in arrival order in an isolated plugin home", async () => {
  const before = process.env.PASEO_HOME;
  process.env.PASEO_HOME = await mkdtemp(join(tmpdir(), "fm-drafts-"));
  const id = "12345678-1234-4234-8234-123456789abc";
  try {
    expect(await readChatDraft(id)).toBe("");
    await writeChatDraft(id, "words");
    expect(await readChatDraft(id)).toBe("words");
    await Promise.all([writeChatDraft(id, "older"), writeChatDraft(id, "")]);
    expect(await readFile(chatDraftFile(id), "utf8")).toBe("");
  } finally {
    if (before === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = before;
  }
});
