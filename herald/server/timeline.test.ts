import { describe, expect, it } from "vitest";
import type { AgentPermissionRequest, AgentTimelineItem } from "@getpaseo/protocol/agent-types";

import {
  describePermission,
  fallbackSpeech,
  firstWords,
  lastUserMessage,
  latestOutputText,
  plainText,
  preview,
  shellCommand,
} from "./timeline";

const timeline: AgentTimelineItem[] = [
  { type: "user_message", text: "Fix the login bug" },
  { type: "assistant_message", text: "Looking into it." },
  { type: "reasoning", text: "The bug is probably in auth.ts" },
  { type: "user_message", text: "Also add a test" },
  { type: "reasoning", text: "private thoughts" },
  { type: "assistant_message", text: "Done. I fixed **auth.ts** and added a test." },
  { type: "error", message: "  " },
  { type: "assistant_message", text: "Anything else?" },
];

describe("latestOutputText", () => {
  it("keeps only assistant text after the last user message", () => {
    expect(latestOutputText(timeline)).toBe("Done. I fixed **auth.ts** and added a test. Anything else?");
  });

  it("concatenates streamed chunks, including ones split inside a word", () => {
    expect(
      latestOutputText([
        { type: "assistant_message", text: "Understood: no age c" },
        { type: "assistant_message", text: "utoff, just drop clos" },
        { type: "assistant_message", text: "ed sessions. " },
        { type: "assistant_message", text: "Nothing else.\n" },
      ]),
    ).toBe("Understood: no age cutoff, just drop closed sessions. Nothing else.");
  });

  it("separates two messages from one turn that arrive without a space", () => {
    expect(
      latestOutputText([
        { type: "assistant_message", text: "Looking into it." },
        { type: "reasoning", text: "reading the file" },
        { type: "assistant_message", text: "Done. I fixed it." },
      ]),
    ).toBe("Looking into it. Done. I fixed it.");
  });

  it("includes errors and is empty when the agent said nothing", () => {
    expect(latestOutputText([{ type: "user_message", text: "hi" }, { type: "error", message: "boom" }])).toBe(
      "Error: boom",
    );
    expect(latestOutputText([{ type: "assistant_message", text: "Half" }, { type: "error", message: "boom" }])).toBe(
      "Half\nError: boom",
    );
    expect(latestOutputText([])).toBe("");
  });
});

describe("lastUserMessage", () => {
  it("returns the most recent non-empty user message", () => {
    expect(lastUserMessage(timeline)).toBe("Also add a test");
    expect(lastUserMessage([{ type: "assistant_message", text: "x" }])).toBeNull();
  });
});

function permission(overrides: Partial<AgentPermissionRequest>): AgentPermissionRequest {
  return { id: "p1", provider: "claude", name: "Bash", kind: "tool", ...overrides };
}

describe("describePermission", () => {
  it("reads a question's title and options", () => {
    const described = describePermission(
      permission({
        name: "AskUserQuestion",
        kind: "question",
        title: "Which database?",
        description: "Postgres / SQLite",
        input: {
          questions: [
            { question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }] },
            { question: "Which ORM?", options: ["Prisma", "Drizzle"] },
          ],
        },
      }),
    );
    expect(described).toEqual({
      reason: "question",
      headline: "Which database? (2 questions)",
      detail: "Postgres / SQLite",
    });
  });

  it("falls back to the raw question when the provider set no title", () => {
    const described = describePermission(
      permission({ kind: "question", input: { questions: [{ question: "Deploy now?", options: [] }] } }),
    );
    expect(described.headline).toBe("Deploy now?");
    expect(described.detail).toBeNull();
  });

  it("names a plan and a tool command", () => {
    expect(describePermission(permission({ kind: "plan", name: "ExitPlanMode" }))).toEqual({
      reason: "plan",
      headline: "Plan ready for your approval",
      detail: null,
    });
    expect(
      describePermission(permission({ detail: { type: "shell", command: "rm -rf build" }, title: "Run command" })),
    ).toEqual({ reason: "permission", headline: "Run command", detail: "rm -rf build" });
    expect(describePermission(permission({ input: { cmd: "git status" } })).detail).toBe("git status");
    expect(describePermission(permission({ name: "Edit" })).headline).toBe("Wants to use Edit");
  });
});

describe("shellCommand", () => {
  it("prefers the typed detail and ignores blanks", () => {
    expect(shellCommand(permission({ detail: { type: "shell", command: " ls " }, input: { command: "x" } }))).toBe(
      "ls",
    );
    expect(shellCommand(permission({ input: { command: "   " } }))).toBeNull();
    expect(shellCommand(permission({}))).toBeNull();
  });
});

describe("plainText and firstWords", () => {
  it("strips markdown a voice would spell out", () => {
    expect(plainText("## Done\n\nI fixed `auth.ts` and **added** a [test](http://x).\n```js\ncode\n```")).toBe(
      "Done I fixed auth.ts and added a test. code block",
    );
  });

  it("cuts at a sentence end or adds an ellipsis", () => {
    expect(firstWords("I fixed the login bug in the auth module. Then I added tests.", 30)).toBe(
      "I fixed the login bug in the auth module.",
    );
    expect(firstWords("one two three four five", 3)).toBe("one two three…");
    expect(firstWords("", 3)).toBe("");
  });
});

describe("preview", () => {
  it("flattens to one line and clips with an ellipsis", () => {
    expect(preview("Fix the **login** bug\nplease")).toBe("Fix the login bug please");
    expect(preview("abcdefghij", 6)).toBe("abcde…");
  });
});

describe("fallbackSpeech", () => {
  it("states each event kind plainly", () => {
    const named = { workspaceTitle: "Shop", agentTitle: "Login fix" };
    expect(fallbackSpeech({ ...named, reason: "question", headline: "Which DB?", detail: "A / B" })).toBe(
      "Login fix has a question: Which DB? Options: A / B.",
    );
    expect(
      fallbackSpeech({ workspaceTitle: null, agentTitle: null, reason: "finished", headline: "Finished", detail: null }),
    ).toBe("An agent finished.");
    // Agents are usually untitled; the workspace names the work.
    expect(
      fallbackSpeech({ workspaceTitle: "Shop", agentTitle: null, reason: "finished", headline: "Finished", detail: "Done." }),
    ).toBe("Shop finished. Done.");
    const bot = { workspaceTitle: null, agentTitle: "Bot" };
    expect(fallbackSpeech({ ...bot, reason: "permission", headline: "Run command", detail: "npm test" })).toBe(
      "Bot is asking for permission. Run command Command: npm test.",
    );
    expect(fallbackSpeech({ ...bot, reason: "error", headline: "Out of credits", detail: null })).toBe(
      "Bot stopped with an error. Out of credits",
    );
    expect(fallbackSpeech({ ...bot, reason: "canceled", headline: "User stopped", detail: null })).toBe(
      "Bot was interrupted. User stopped",
    );
    expect(fallbackSpeech({ ...bot, reason: "plan", headline: "Plan ready", detail: null })).toBe(
      "Bot has a plan ready for your approval. Plan ready",
    );
  });
});
