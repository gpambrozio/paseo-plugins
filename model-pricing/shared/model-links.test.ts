import { describe, expect, it } from "vitest";

import { modelPageUrl } from "./model-links";
import type { PriceRow } from "./pricing";
import { PROVIDER_IDS } from "./providers";

/** Only the two fields a link is derived from matter; the rest is ballast. */
function row(providerId: string, modelId: string): PriceRow {
  return {
    providerId,
    modelId,
    name: modelId,
    contextTokens: null,
    outputTokens: null,
    inputCost: 1,
    outputCost: 1,
    reasoning: null,
    toolCall: null,
    structuredOutput: null,
    temperature: null,
    releaseDate: null,
  };
}

const url = (providerId: string, modelId: string): string | null => modelPageUrl(row(providerId, modelId));

describe("modelPageUrl", () => {
  it("drops Anthropic's prefix and its pinned date", () => {
    expect(url("anthropic", "claude-sonnet-5")).toBe(
      "https://platform.claude.com/docs/en/models/sonnet-5/overview",
    );
    // The dated alias shares the page of the model it pins.
    expect(url("anthropic", "claude-sonnet-4-5-20250929")).toBe(
      "https://platform.claude.com/docs/en/models/sonnet-4-5/overview",
    );
    expect(url("anthropic", "claude-opus-4-5")).toBe(
      "https://platform.claude.com/docs/en/models/opus-4-5/overview",
    );
  });

  it("drops OpenAI's snapshot date and nothing else", () => {
    expect(url("openai", "gpt-6-astra")).toBe("https://developers.openai.com/api/docs/models/gpt-6-astra");
    expect(url("openai", "gpt-4o-2024-08-06")).toBe("https://developers.openai.com/api/docs/models/gpt-4o");
    // A version number is not a date: `4.1` and `5.3-codex` keep their shape.
    expect(url("openai", "gpt-4.1-mini")).toBe("https://developers.openai.com/api/docs/models/gpt-4.1-mini");
    expect(url("openai", "gpt-5.3-codex")).toBe("https://developers.openai.com/api/docs/models/gpt-5.3-codex");
  });

  it("sends an Ollama tag to the library page that lists it", () => {
    expect(url("ollama", "minimax-m2.7")).toBe("https://ollama.com/library/minimax-m2.7");
    expect(url("ollama", "gpt-oss:120b")).toBe("https://ollama.com/library/gpt-oss");
    expect(url("ollama", "mistral-large-3:675b")).toBe("https://ollama.com/library/mistral-large-3");
  });

  it("uses an OpenRouter id as the path, slashes and tildes intact", () => {
    expect(url("openrouter", "x-ai/grok-4.7")).toBe("https://openrouter.ai/x-ai/grok-4.7");
    expect(url("openrouter", "~openai/gpt-astra-latest")).toBe("https://openrouter.ai/~openai/gpt-astra-latest");
  });

  it("files a Fireworks model under its owner, defaulting to fireworks", () => {
    expect(url("fireworks", "accounts/fireworks/models/deepseek-v4p1-flash")).toBe(
      "https://fireworks.ai/models/deepseek-ai/deepseek-v4p1-flash",
    );
    // Same vendor, same family, different owner on the site — which is why the
    // exceptions are a list and not a rule.
    expect(url("fireworks", "accounts/fireworks/models/deepseek-v4-pro")).toBe(
      "https://fireworks.ai/models/fireworks/deepseek-v4-pro",
    );
    expect(url("fireworks", "accounts/fireworks/models/kimi-k3")).toBe(
      "https://fireworks.ai/models/fireworks/kimi-k3",
    );
  });

  it("sends a Fireworks router to the filtered model list, since it has no page", () => {
    expect(url("fireworks", "accounts/fireworks/routers/kimi-latest")).toBe(
      "https://fireworks.ai/models?search=kimi-latest",
    );
  });

  it("has no link for a provider it does not know", () => {
    expect(url("mistral", "mistral-large")).toBeNull();
  });

  it("has no link for an id that strips to nothing", () => {
    expect(url("anthropic", "claude-")).toBeNull();
    expect(url("ollama", ":32b")).toBeNull();
    expect(url("openrouter", "")).toBeNull();
    expect(url("fireworks", "accounts/fireworks/models/")).toBeNull();
  });

  it("links every provider the plugin ships", () => {
    for (const providerId of PROVIDER_IDS) {
      expect(url(providerId, "accounts/fireworks/models/example")).not.toBeNull();
    }
  });
});
