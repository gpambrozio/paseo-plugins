import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FirstmateConfig } from "../shared/fleet";
import type { TopicMessage } from "../shared/topics";
import type { PaseoApi } from "./host-types";
import { MAX_TOPIC_MESSAGES, TopicLog, mergeTopicMessages, registerTopicSync } from "./topic-log";

const MATE = "5d1c2f0e-0000-4000-8000-000000000001";

/** A first-mate message with id `m:<n>`, said `n` seconds past ten. */
function message(n: number, text = `m${n}`): TopicMessage {
  return { id: `m:${n}`, from: "mate", text, at: `2026-09-22T10:00:${String(n).padStart(2, "0")}.000Z` };
}

const MATE_B = "7b2e0000-0000-4000-8000-000000000002";

type Item = { type: string; text?: string; at?: string };

/** A paseo whose first mate's timeline is `items`, entry n starting at seq `firstSeq` + n; `reads` counts its timeline reads. */
function fakePaseo(items: () => Item[], reads: { count: number } = { count: 0 }, firstSeq = 1, minute = 0): PaseoApi {
  return {
    agents: {
      ref: () => ({
        timeline: {
          async refetch() {
            reads.count += 1;
            return {
              entries: items().map((item, index) => ({
                item,
                seqStart: firstSeq + index,
                seqEnd: firstSeq + index,
                timestamp: item.at ?? `2026-09-22T10:${String(minute).padStart(2, "0")}:${String(firstSeq + index).padStart(2, "0")}.000Z`,
              })),
            };
          },
        },
        async refresh() {
          return { agent: { id: MATE, updatedAt: "t2", archivedAt: null } };
        },
      }),
    },
  } as unknown as PaseoApi;
}

let before: string | undefined;
beforeEach(async () => {
  before = process.env.PASEO_HOME;
  process.env.PASEO_HOME = await mkdtemp(join(tmpdir(), "fm-topics-"));
});
afterEach(() => {
  if (before === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = before;
  vi.restoreAllMocks();
});

describe("mergeTopicMessages", () => {
  it("replaces a message by its id and keeps the newest 200, oldest by time first", () => {
    expect(mergeTopicMessages([message(1, "Aye"), message(3)], [message(1, "Aye, captain."), message(2)]).map((m) => m.text)).toEqual([
      "Aye, captain.",
      "m2",
      "m3",
    ]);
    const kept = Array.from({ length: MAX_TOPIC_MESSAGES }, (_, index) => message(index + 1));
    const merged = mergeTopicMessages(kept, [message(MAX_TOPIC_MESSAGES + 1)]);
    expect(merged).toHaveLength(MAX_TOPIC_MESSAGES);
    expect(merged[0]?.id).toBe("m:2");
  });
});

describe("TopicLog", () => {
  const conversation: Item[] = [
    { type: "user_message", text: "[topic: fix-flaky-login] any news?" },
    { type: "assistant_message", text: "[topic: fix-flaky-login] Looking." },
    { type: "user_message", text: "unrelated" },
    { type: "assistant_message", text: "Not filed." },
  ];

  it("files the tagged conversation, kept in topics.json, and skips a read while updatedAt is unchanged", async () => {
    const reads = { count: 0 };
    const paseo = fakePaseo(() => conversation, reads);
    const log = new TopicLog();
    await log.sync(paseo, { id: MATE, updatedAt: "t1" });
    await log.sync(paseo, { id: MATE, updatedAt: "t1" });
    expect(reads.count).toBe(1);
    expect((await log.messages("fix-flaky-login")).map((m) => [m.from, m.id, m.text])).toEqual([
      ["captain", `${MATE}:1`, "any news?"],
      ["mate", `${MATE}:2`, "Looking."],
    ]);
    expect((await log.latest()).get("fix-flaky-login")?.text).toBe("Looking.");
    const stored = JSON.parse(await readFile(join(process.env.PASEO_HOME ?? "", "plugin-data", "firstmate", "topics.json"), "utf8"));
    expect(Object.keys(stored)).toEqual(["topics"]);
    await log.sync(paseo, { id: MATE, updatedAt: "t2" });
    expect(reads.count).toBe(2);
  });

  it("keeps a message the tail no longer holds, and lets a reply that grew replace itself", async () => {
    const log = new TopicLog();
    await log.sync(fakePaseo(() => conversation), { id: MATE, updatedAt: "t1" });
    const tail: Item[] = [
      { type: "user_message", text: "[topic: fix-flaky-login] again" },
      { type: "assistant_message", text: "[topic: fix-flaky-login] Still " },
    ];
    await log.sync(fakePaseo(() => tail, undefined, 5), { id: MATE, updatedAt: "t2" });
    tail.push({ type: "assistant_message", text: "looking." });
    await log.sync(fakePaseo(() => tail, undefined, 5), { id: MATE, updatedAt: "t3" });
    expect((await log.messages("fix-flaky-login")).map((m) => m.text)).toEqual([
      "any news?",
      "Looking.",
      "again",
      "Still looking.",
    ]);
  });

  it("keeps every message when one first mate files, another files, and the first files again", async () => {
    const log = new TopicLog();
    const a1: Item[] = [{ type: "user_message", text: "[topic: fix-flaky-login] from A", at: "2026-09-22T10:00:01.000Z" }];
    const b1: Item[] = [{ type: "user_message", text: "[topic: fix-flaky-login] from B", at: "2026-09-22T10:01:01.000Z" }];
    const a2: Item[] = [...a1, { type: "user_message", text: "[topic: fix-flaky-login] A again", at: "2026-09-22T10:02:02.000Z" }];
    await log.sync(fakePaseo(() => a1, undefined, 1, 0), { id: MATE, updatedAt: "t1" });
    await log.sync(fakePaseo(() => b1, undefined, 1, 1), { id: MATE_B, updatedAt: "t1" });
    await log.sync(fakePaseo(() => a2, undefined, 1, 2), { id: MATE, updatedAt: "t2" });
    expect((await log.messages("fix-flaky-login")).map((m) => [m.id, m.text])).toEqual([
      [`${MATE}:1`, "from A"],
      [`${MATE_B}:1`, "from B"],
      [`${MATE}:2`, "A again"],
    ]);
  });

  it("reads nothing for a topic that was never filed", async () => {
    expect(await new TopicLog().messages("nope")).toEqual([]);
  });
});

describe("registerTopicSync", () => {
  type Handler = (event: { agent: { id: string } }, context: { paseo: PaseoApi }) => Promise<void>;

  function setup(mateAgentId: string) {
    let handler: Handler | null = null;
    const server = {
      addHook(_name: string, registered: Handler) {
        handler = registered;
        return () => {};
      },
    };
    const log = new TopicLog();
    registerTopicSync(
      server as unknown as Parameters<typeof registerTopicSync>[0],
      log,
      async () => ({ mateAgentId }) as FirstmateConfig,
    );
    return {
      log,
      end: (agentId: string) => (handler as Handler | null)?.({ agent: { id: agentId } }, { paseo: fakePaseo(() => [
        { type: "user_message", text: "[topic: fix-flaky-login] hello" },
      ]) }),
    };
  }

  it("files the conversation when the first mate's turn ends, and only then", async () => {
    const { log, end } = setup(MATE);
    await end("a-crewmate");
    expect(await log.messages("fix-flaky-login")).toEqual([]);
    await end(MATE);
    expect((await log.messages("fix-flaky-login")).map((m) => m.text)).toEqual(["hello"]);
  });
});
