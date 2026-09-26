import { describe, expect, it } from "vitest";

import { FirstmateConfigSchema } from "../shared/fleet";
import type { PaseoApi } from "./host-types";
import { deliverToMate } from "./watch-service";

/** A Paseo whose first mate is in `status`, recording what is sent to it. */
function paseoWith(status: string) {
  const sent: Array<{ text: string; options: unknown }> = [];
  const paseo = {
    agents: {
      ref: (id: string) => ({
        refresh: async () => ({ agent: { id, status, archivedAt: null } }),
        send: async (text: string, options: unknown) => {
          sent.push({ text, options });
        },
      }),
    },
  } as unknown as PaseoApi;
  return { paseo, sent };
}

const config = FirstmateConfigSchema.parse({ mateAgentId: "mate-1" });

describe("deliverToMate", () => {
  it("never sends into a running turn, however it came to be asked", async () => {
    for (const status of ["running", "initializing"]) {
      const { paseo, sent } = paseoWith(status);
      expect(await deliverToMate(paseo, config, "note")).toBe("wait");
      expect(sent).toEqual([]);
    }
  });

  it("sends to an idle first mate without interrupting, and waits without one or without Paseo", async () => {
    const { paseo, sent } = paseoWith("idle");
    expect(await deliverToMate(paseo, config, "note")).toBe("sent");
    expect(sent).toEqual([
      { text: "note", options: { activeTurnBehavior: "steer", messageId: expect.stringMatching(/^firstmate-watch-[0-9a-f-]{36}$/) } },
    ]);
    expect(await deliverToMate(paseo, FirstmateConfigSchema.parse({}), "note")).toBe("wait");
    expect(await deliverToMate(null, config, "note")).toBe("wait");
  });
});
