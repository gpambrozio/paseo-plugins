import { it, expect } from "vitest";
import { createDraftStore } from "./draft";
import { prepareDraftSend } from "./draft-send";

it("keeps a failed send durable, then clears a successful unchanged send", () => {
  const store = createDraftStore({});
  store.set("mate", "words");
  prepareDraftSend(store, "mate", "words")(false);
  expect(store.get("mate")).toBe("words");
  prepareDraftSend(store, "mate", "words")(true);
  expect(store.get("mate")).toBe("");
});
it("does not clear a follow-up even when it is retyped identically", () => {
  const store = createDraftStore({});
  store.set("mate", "words");
  const finish = prepareDraftSend(store, "mate", "words");
  store.set("mate", "other");
  store.set("mate", "words");
  finish(true);
  expect(store.get("mate")).toBe("words");
});
