import { useEffect } from "react";
import { AppState } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { readChatDraft, writeChatDraft } from "../shared/drafts";
import { drafts } from "./draft";
import { persistDraft } from "./draft-persistence";

type Entry = {
  controller: ReturnType<typeof persistDraft>;
  transport: { read: () => Promise<string>; write: (text: string) => Promise<unknown> };
};
const slot = Symbol.for("paseo.firstmate.durable-chat-drafts");
const controllers: Map<string, Entry> = Reflect.get(globalThis, slot) ?? new Map();
Reflect.set(globalThis, slot, controllers);
/** Keep the queue and listeners across host reconnects, but flush before disposal. */
export function stopChatDrafts(): void {
  controllers.forEach(entry => { void entry.controller.flush(); });
}
export function useChatDraftPersistence(agentId: string): void {
  const read = useRpc(readChatDraft);
  const write = useRpc(writeChatDraft);
  useEffect(() => {
    let entry = controllers.get(agentId);
    if (!entry) {
      const transport = {
        read: async () => (await read({ agentId })).text,
        write: (text: string) => write({ agentId, text }),
      };
      const created: Entry = {
        transport,
        controller: persistDraft(drafts, agentId,
          () => transport.read(), text => transport.write(text),
          error => console.warn("[firstmate] draft persistence failed", error)),
      };
      entry = created;
      controllers.set(agentId, entry);
    }
    entry.transport.read = async () => (await read({ agentId })).text;
    entry.transport.write = text => write({ agentId, text });
    const active = entry.controller;
    void active.hydrate();
    void active.flush();
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") void active.flush();
      else { void active.hydrate(); void active.flush(); }
    });
    return () => { subscription.remove(); void active.flush(); };
  }, [agentId, read, write]);
}
