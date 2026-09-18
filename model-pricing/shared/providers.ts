/**
 * The five providers this plugin prices, and which upstream each one is read
 * from. Plain values, so both halves import it: the server maps requested
 * provider ids to the sources it has to fetch, the client draws the labels and
 * the legend.
 *
 * Only two upstreams exist, because only two publish prices without a key:
 *
 * - **models.dev** (`https://models.dev/api.json`) is a community catalog whose
 *   model shape is exactly the columns this table wants — context, max output,
 *   input/output cost, and the four capability flags. It is the only public
 *   source of Anthropic, OpenAI and Fireworks prices at all: each of those
 *   vendors' own `GET /v1/models` needs an API key *and* returns no prices.
 * - **OpenRouter** (`https://openrouter.ai/api/v1/models`) publishes its own,
 *   unauthenticated and live. models.dev mirrors it too, but a few dozen models
 *   behind, so the table reads it first-hand.
 *
 * Adding a provider is a row here plus, if it is not on models.dev, a fetcher
 * and a normalizer in `server/`.
 */

/** An upstream the daemon fetches. One fetch and one cache entry per source. */
export const SOURCE_IDS = ["models-dev", "openrouter"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/**
 * The legend dot's colour, as a *token name* rather than a colour. Client code
 * resolves it against `theme.colors`, because a literal renders wrong in half
 * the themes and these are the only five tokens that read as distinct hues.
 */
export type AccentToken = "accent" | "statusSuccess" | "statusWarning" | "statusDanger" | "foregroundMuted";

export interface ProviderInfo {
  /** This plugin's own id. Stable: it is what the settings document stores. */
  readonly id: string;
  readonly label: string;
  readonly source: SourceId;
  /**
   * models.dev's key for this provider, or `null` when the provider has its own
   * fetcher. Note `fireworks-ai` and `ollama-cloud` — the keys are not the ids.
   */
  readonly catalogKey: string | null;
  readonly accentToken: AccentToken;
  /** Where a human checks the number this table shows. */
  readonly doc: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    source: "models-dev",
    catalogKey: "anthropic",
    accentToken: "statusWarning",
    doc: "https://www.anthropic.com/pricing",
  },
  {
    id: "openai",
    label: "OpenAI",
    source: "models-dev",
    catalogKey: "openai",
    accentToken: "statusSuccess",
    doc: "https://openai.com/api/pricing/",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    source: "models-dev",
    catalogKey: "fireworks-ai",
    accentToken: "accent",
    doc: "https://fireworks.ai/pricing",
  },
  {
    id: "ollama",
    label: "Ollama Cloud",
    source: "models-dev",
    catalogKey: "ollama-cloud",
    accentToken: "statusDanger",
    doc: "https://docs.ollama.com/cloud",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    source: "openrouter",
    catalogKey: null,
    accentToken: "foregroundMuted",
    doc: "https://openrouter.ai/models",
  },
];

export const PROVIDER_IDS: readonly string[] = PROVIDERS.map((provider) => provider.id);

export function providerById(id: string): ProviderInfo | null {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function providerLabel(id: string): string {
  return providerById(id)?.label ?? id;
}

/**
 * Which upstreams have to be fetched to answer for these providers. Four of the
 * five share `models-dev`, so switching Anthropic off saves a fetch only once
 * OpenAI, Fireworks and Ollama Cloud are off too.
 */
export function sourcesFor(providerIds: readonly string[]): SourceId[] {
  const needed = new Set<SourceId>();
  for (const id of providerIds) {
    const provider = providerById(id);
    if (provider !== null) needed.add(provider.source);
  }
  return SOURCE_IDS.filter((source) => needed.has(source));
}

/** The provider ids served by one source, in catalog order. */
export function providersOfSource(source: SourceId): readonly ProviderInfo[] {
  return PROVIDERS.filter((provider) => provider.source === source);
}
