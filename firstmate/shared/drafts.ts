import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const key = z.object({ agentId: z.string().uuid() });
export const readChatDraft = defineRpc({
  name: "firstmate.drafts.read", input: key, output: z.object({ text: z.string() }),
});
export const writeChatDraft = defineRpc({
  name: "firstmate.drafts.write", input: key.extend({ text: z.string() }), output: z.object({}),
});
