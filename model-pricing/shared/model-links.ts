/**
 * Where a row goes when it is pressed: the vendor's own page for that model.
 *
 * **Neither upstream publishes a link.** models.dev carries a `doc` per
 * *provider* and nothing per model, and OpenRouter's `links` are API paths, not
 * pages. So every URL here is derived from the model id, and the rules were
 * taken by checking each one against the live site rather than guessed — the
 * whole Anthropic, OpenAI and Ollama Cloud catalogs answered 200 under the
 * rules below on 2026-09-21.
 *
 * Two consequences worth keeping in mind:
 *
 * - **A derived link is best effort.** A vendor that undocuments a model, or
 *   renames its page, breaks a link here and nothing in this repo will notice;
 *   `null` is reserved for ids this module cannot make a URL out of at all, not
 *   for ids whose page may have moved. Verifying at press time would mean a
 *   request per row and is not worth it.
 * - **Nothing here fetches.** It is pure string work, so `model-links.test.ts`
 *   covers every rule offline and the client can call it while rendering.
 */
import type { PriceRow } from "./pricing";

/**
 * Anthropic's ids carry a `claude-` prefix their doc slugs drop, and the pinned
 * aliases carry a date the docs do not have a page for: `claude-sonnet-5` is
 * documented at `sonnet-5`, and `claude-sonnet-4-5-20250929` shares
 * `sonnet-4-5` with the alias it pins. Both strips are needed; either alone
 * leaves some of the catalog 404ing.
 */
function anthropicUrl(modelId: string): string | null {
  const slug = modelId.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  if (slug === "") return null;
  return `https://platform.claude.com/docs/en/models/${slug}/overview`;
}

/**
 * OpenAI documents a model at its bare id, and a dated snapshot on the page of
 * the model it is a snapshot of — `gpt-4o-2024-08-06` is documented under
 * `gpt-4o`. Note the date shape differs from Anthropic's: hyphenated, not
 * `YYYYMMDD`.
 *
 * One model in the catalog has no page under any rule (`gpt-5.3-codex-spark`
 * on the day this was written, which OpenAI has simply not documented). It gets
 * a link that 404s rather than a special case, because the next undocumented
 * model will be a different one.
 */
function openaiUrl(modelId: string): string | null {
  const slug = modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (slug === "") return null;
  return `https://developers.openai.com/api/docs/models/${slug}`;
}

/**
 * Ollama files a model under its library name, and the `:tag` half of an id is
 * a variant listed *on* that page — `gpt-oss:120b` is a row on
 * `/library/gpt-oss`. Some tags happen to resolve as URLs of their own and some
 * do not (`mistral-large-3:675b` does not), so the tag is always dropped: the
 * library page is right for every id in the catalog and carries the tag anyway.
 */
function ollamaUrl(modelId: string): string | null {
  const name = modelId.split(":")[0] ?? "";
  if (name === "") return null;
  return `https://ollama.com/library/${name}`;
}

/**
 * OpenRouter's id *is* its page path, slashes and all, including the `~` that
 * prefixes its alias models. Nothing is encoded, because encoding the slash
 * would break the path.
 */
function openRouterUrl(modelId: string): string | null {
  if (modelId === "") return null;
  return `https://openrouter.ai/${modelId}`;
}

/**
 * Fireworks model pages are `/models/<owner>/<slug>`, and **the owner is not in
 * the id.** models.dev gives `accounts/fireworks/models/deepseek-v4p1-flash`,
 * whose page is under `deepseek-ai/`, while `deepseek-v4-pro` — same vendor,
 * same family — is under `fireworks/`. There is no rule; the site simply files
 * a few models under the account that uploaded them.
 *
 * Almost everything is `fireworks/`: of the 316 model pages listed on
 * fireworks.ai on 2026-09-21, 304 were. So the exceptions are listed here and
 * everything else takes the default. The list is the whole site's exceptions,
 * not just the ones models.dev prices today, so a model the catalog picks up
 * later is already right.
 *
 * **This map goes stale silently.** A model added under a new owner links to a
 * 404 until it is added here, which is the price of a per-model page; the
 * alternative was sending every Fireworks row to a search page.
 */
const FIREWORKS_OWNERS: Readonly<Record<string, string>> = {
  "cogito-671b-v2-p1": "cogito",
  "deepseek-v3p1-terminus": "deepseek-ai",
  "deepseek-v4-flash-0731": "deepseek-ai",
  "deepseek-v4-flash-vision-exp": "deepseek-ai",
  "deepseek-v4-pro-0813": "deepseek-ai",
  "deepseek-v4p1-flash": "deepseek-ai",
  "dobby-mini-unhinged-plus-llama-3-1-8b": "sentientfoundation-serverless",
  "dobby-unhinged-llama-3-3-70b-new": "sentientfoundation",
  "yi-34b": "yi-01-ai",
  "yi-34b-chat": "yi-01-ai",
  "yi-6b": "yi-01-ai",
  "yi-large": "yi-01-ai",
};

/** The owner every Fireworks model that is not an exception is filed under. */
const FIREWORKS_DEFAULT_OWNER = "fireworks";

/**
 * A third of the Fireworks catalog is `accounts/fireworks/routers/…` — aliases
 * like `kimi-latest` that resolve to whichever model is current. **Routers have
 * no page at all**, so they get the models list filtered to the name instead of
 * a link that is certain to 404.
 */
function fireworksUrl(modelId: string): string | null {
  const slug = modelId.split("/").pop() ?? "";
  if (slug === "") return null;
  if (!modelId.includes("/models/")) {
    return `https://fireworks.ai/models?search=${encodeURIComponent(slug)}`;
  }
  const owner = FIREWORKS_OWNERS[slug] ?? FIREWORKS_DEFAULT_OWNER;
  return `https://fireworks.ai/models/${owner}/${slug}`;
}

/**
 * The vendor's page for one row, or `null` when there is no rule for it — an
 * id from a provider this build does not know, or one that strips to nothing.
 * The table leaves a `null` row unpressable rather than sending the user
 * somewhere approximate.
 */
export function modelPageUrl(row: PriceRow): string | null {
  switch (row.providerId) {
    case "anthropic":
      return anthropicUrl(row.modelId);
    case "openai":
      return openaiUrl(row.modelId);
    case "fireworks":
      return fireworksUrl(row.modelId);
    case "ollama":
      return ollamaUrl(row.modelId);
    case "openrouter":
      return openRouterUrl(row.modelId);
    default:
      return null;
  }
}
