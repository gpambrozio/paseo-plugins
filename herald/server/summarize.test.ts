import { describe, expect, it, vi } from "vitest";
import type { PaseoAgentHandle, PaseoApi } from "@getpaseo/client";

import { DEFAULT_SUMMARY_PROMPT } from "../shared/herald";
import {
  HELPER_TITLE,
  buildPrompt,
  parseSummaryText,
  renderPrompt,
  summarize,
  type SummaryRequest,
} from "./summarize";

const request: SummaryRequest = {
  agent: { id: "a1", workspaceId: "w1", workspaceTitle: "Shop", cwd: "/Users/me/repo", title: "Login fix" },
  reason: "finished",
  headline: "Finished",
  detail: "I fixed it.",
  output: "I fixed **auth.ts**. ".repeat(3),
  lastUser: "Fix the login bug",
};

describe("buildPrompt", () => {
  it("names the agent, the event, and what was said", () => {
    const prompt = buildPrompt(request);
    expect(prompt).toContain('Agent: "Login fix", working in the workspace "Shop" (folder repo).');
    expect(prompt).toContain("Event: The agent finished its turn");
    expect(prompt).toContain("Detail: I fixed it.");
    expect(prompt).toContain("What the user last asked for: Fix the login bug");
    expect(prompt).toContain("What the agent said: I fixed **auth.ts**.");
    expect(prompt).toContain("Start with the agent's name");
  });

  it("clips a long final message and skips empty sections", () => {
    const prompt = buildPrompt({
      ...request,
      output: "x".repeat(7000),
      lastUser: null,
      detail: null,
      agent: { ...request.agent, title: null, workspaceTitle: null },
    });
    expect(prompt).toContain("[…truncated]");
    expect(prompt).not.toContain("What the user last asked for");
    expect(prompt).not.toContain("Detail:");
    expect(prompt).toContain('Agent: "an agent", working in the workspace "repo"');
    // An untitled agent takes the workspace's title as its name.
    expect(buildPrompt({ ...request, agent: { ...request.agent, title: null } })).toContain('Agent: "Shop"');
  });

  it("renders the user's template, and reads a blank one as the default", () => {
    const prompt = buildPrompt(request, "Tell me about {{agent}} in German.\nEvent: {{event}}");
    expect(prompt).toBe(
      "Tell me about Login fix in German.\nEvent: The agent finished its turn and is waiting for the user.",
    );
    expect(buildPrompt(request, "   ")).toBe(buildPrompt(request));
    expect(buildPrompt(request, DEFAULT_SUMMARY_PROMPT)).toBe(buildPrompt(request));
  });
});

describe("renderPrompt", () => {
  const values = { agent: "Login fix", detail: "", output: "It is done." };

  it("drops a whole line whose placeholder is empty for this event", () => {
    expect(renderPrompt("Agent: {{agent}}\nDetail: {{detail}}\nSaid: {{output}}", values)).toBe(
      "Agent: Login fix\nSaid: It is done.",
    );
  });

  it("collapses the blank lines a dropped line leaves behind", () => {
    expect(renderPrompt("A\n\n{{detail}}\n\nB", values)).toBe("A\n\nB");
  });

  it("leaves a name it does not know exactly as typed", () => {
    expect(renderPrompt("Say {{agent}} and {{nonsense}}.", values)).toBe("Say Login fix and {{nonsense}}.");
  });

  it("accepts spaces inside the braces", () => {
    expect(renderPrompt("{{ agent }}", values)).toBe("Login fix");
  });
});

describe("parseSummaryText", () => {
  it("reads the structured output and strips markdown", () => {
    expect(parseSummaryText('{"speech":"Login fix is **done**."}')).toBe("Login fix is done.");
  });

  it("finds JSON inside prose or fences, and falls back to the prose itself", () => {
    expect(parseSummaryText('```json\n{"speech": "Hello there."}\n```')).toBe("Hello there.");
    // Seen from a live helper: the object fenced and under a key of the model's own choosing.
    expect(parseSummaryText('```json\n{\n  "spoken": "Herald test finished. No changes needed."\n}\n```')).toBe(
      "Herald test finished. No changes needed.",
    );
    expect(parseSummaryText('Here you go:\n{"speech": "Done.", "note": "x"}')).toBe("Done.");
    expect(parseSummaryText("```\nJust prose in a fence.\n```")).toBe("Just prose in a fence.");
    expect(parseSummaryText("Login fix finished the work. Nothing is left.")).toBe(
      "Login fix finished the work.",
    );
    expect(() => parseSummaryText("   ")).toThrow("returned nothing");
    expect(() => parseSummaryText(null)).toThrow("returned nothing");
  });
});

interface FakeHelper {
  handle: PaseoAgentHandle;
  archive: ReturnType<typeof vi.fn>;
  respondToPermission: ReturnType<typeof vi.fn>;
}

function fakePaseo(finish: unknown): { paseo: PaseoApi; create: ReturnType<typeof vi.fn>; helper: FakeHelper } {
  const archive = vi.fn(async () => ({ archivedAt: "now" }));
  const respondToPermission = vi.fn(async () => {});
  const handle = {
    id: "h1",
    waitForFinish: vi.fn(async () => finish),
    archive,
    respondToPermission,
  } as unknown as PaseoAgentHandle;
  const create = vi.fn(async () => handle);
  const paseo = { workspaces: { ref: () => ({ agents: { create } }) } } as unknown as PaseoApi;
  return { paseo, create, helper: { handle, archive, respondToPermission } };
}

describe("summarize", () => {
  it("creates a delegated, auto-archived helper and returns its sentence", async () => {
    const { paseo, create, helper } = fakePaseo({
      status: "idle",
      final: null,
      error: null,
      lastMessage: '{"speech":"Login fix is done."}',
    });
    const seen: string[] = [];
    const summary = await summarize(request, {
      paseo,
      provider: "claude/claude-haiku-4-5",
      timeoutMs: 1000,
      prompt: "Summarise {{agent}}.",
      onHelperCreated: (id) => seen.push(id),
    });
    expect(summary).toEqual({ text: "Login fix is done.", model: "claude/claude-haiku-4-5" });
    expect(seen).toEqual(["h1"]);
    const options = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      config: { provider: "claude/claude-haiku-4-5" },
      parent: "a1",
      title: HELPER_TITLE,
      autoArchive: true,
      labels: { "herald.role": "summarizer" },
    });
    expect(options.outputSchema).toMatchObject({ required: ["speech"] });
    expect(options.prompt).toBe("Summarise Login fix.");
    expect(helper.archive).not.toHaveBeenCalled();
  });

  it("denies a helper that asks for a tool, archives it, and fails", async () => {
    const { paseo, helper } = fakePaseo({
      status: "permission",
      final: { pendingPermissions: [{ id: "p9" }] },
      error: null,
      lastMessage: null,
    });
    await expect(summarize(request, { paseo, provider: "p/m", timeoutMs: 1000 })).rejects.toThrow(
      "tried to use a tool",
    );
    expect(helper.respondToPermission).toHaveBeenCalledWith({
      requestId: "p9",
      response: { behavior: "deny", message: "Herald summaries must not use tools.", interrupt: true },
    });
    expect(helper.archive).toHaveBeenCalled();
  });

  it("archives a helper that timed out or errored", async () => {
    const { paseo, helper } = fakePaseo({ status: "timeout", final: null, error: null, lastMessage: null });
    await expect(summarize(request, { paseo, provider: "p/m", timeoutMs: 1000 })).rejects.toThrow(
      "status timeout",
    );
    expect(helper.archive).toHaveBeenCalled();
  });

  it("refuses an agent without a workspace", async () => {
    const { paseo, create } = fakePaseo(null);
    await expect(
      summarize({ ...request, agent: { ...request.agent, workspaceId: null } }, { paseo, provider: "p/m", timeoutMs: 1 }),
    ).rejects.toThrow("no workspace");
    expect(create).not.toHaveBeenCalled();
  });
});
