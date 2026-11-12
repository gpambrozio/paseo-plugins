import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pluginDir } from "./data-dir";
import { serialized } from "./serialize";

/** RPC schemas validate the UUID before it becomes a filename. */
export function chatDraftFile(agentId: string): string {
  return join(pluginDir(), "chat-drafts", `${agentId}.txt`);
}
export async function readChatDraft(agentId: string): Promise<string> {
  return serialized(chatDraftFile(agentId), async () => {
    try { return await readFile(chatDraftFile(agentId), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  });
}
export async function writeChatDraft(agentId: string, text: string): Promise<void> {
  return serialized(chatDraftFile(agentId), async () => {
    const directory = join(pluginDir(), "chat-drafts");
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `${agentId}.${randomUUID()}.tmp`);
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, chatDraftFile(agentId));
  });
}
