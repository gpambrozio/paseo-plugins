# model-pricing

A Paseo plugin that adds a **Model pricing** panel to the sidebar: one table of what every model on
the providers you follow costs, so choosing which model to point an agent at does not mean opening
five vendor pricing pages and doing arithmetic.

Each row carries the price per million tokens in and out, the context window, how much the model can
write in one go, whether it can reason, call tools, return structured output and take a temperature,
and a relative-cost figure that measures it against the cheapest model on screen. Sort by any of it,
search for a model by name, and switch providers on and off.

Prices come from two places, neither of which needs an API key. Anthropic, OpenAI and Fireworks AI
publish no pricing API at all — their own model endpoints want a key and return no prices — so those
three, together with Ollama Cloud, are read from [models.dev](https://models.dev), a community
catalog of model specifications. OpenRouter publishes its own, so it is read directly from
OpenRouter. The daemon does the fetching; nothing is sent anywhere.

![The Model pricing panel: a subtitle reading "Agent-capable models, 80/20 input:output blend,
cheapest = 1.0x, USD per 1M tokens, updated 1 hour ago", a row of coloured provider dots for
Anthropic, OpenAI, Fireworks AI and Ollama Cloud, a search box, and a table with columns for model,
context, output, price, reasoning, tool call, structured, temperature, relative and platform. The
rows run from o1-pro at $150 / $600 and 3000.0x down to Claude Fable 5.1 at $10 / $50, each with a
coloured strip at its left edge matching its platform.](docs/screenshot.png)

## What you need

- Paseo 0.8.0 or newer, with plugins enabled.
- Network access from the daemon machine to `models.dev` and `openrouter.ai`.

No accounts, keys or logins. The plugin only reads public price lists.

## Install

```bash
paseo plugin install npm:@gpambrozio/paseo-model-pricing
```

That is the shortest route on **Paseo 0.9 or newer**, which installs plugins straight from npm; add
`@<version>` to pin one. On 0.8, install from this repository instead:

```bash
paseo plugin add gpambrozio/paseo-plugins --path model-pricing
```

Pin a repository install with `--ref model-pricing/v<version>`. To hack on it, clone the repository
and `paseo plugin install "$PWD"` from this folder after `npm install` and `npm run typecheck`.

## Settings

Under **Settings › Plugins › Model pricing**, or the gear in the panel header.

**Providers.** One switch each for Anthropic, OpenAI, Fireworks AI, Ollama Cloud and OpenRouter. A
provider switched off is not shown *and not fetched*, so turning off the ones you do not use makes
the panel lighter as well as shorter. All five are on to begin with, which is a little over five
hundred models — OpenRouter alone is four hundred of them.

**Input / output blend.** The relative-cost column needs one number per model, and a model's input
and output prices are usually different, often by five times. This setting says how much of that
blend is input. The default, 80/20, suits an agent that reads a large repository and writes a small
patch; a chat that drafts prose is closer to 25/75. The ranking genuinely reorders between them,
which is why it is a choice rather than a constant. The prices themselves are always shown in full,
so only the last column changes.

**Only models that can call tools.** On by default, because a model that cannot call a tool cannot
run an agent. Models whose provider does not say either way are always shown rather than guessed at.

### Hiding a provider for a moment

The coloured dots under the heading are buttons. Tap one and that provider's models drop out of the
table and its dot goes hollow; tap it again and they come back. This is instant and does not touch
the network — it is for narrowing the table while you compare two providers, not for saying which
ones you care about. Use the settings switches for that: a provider switched off there is not
fetched at all. Hiding is forgotten when you restart the app.

## Reading the table

Prices are US dollars per million tokens, written input first. An em dash means the provider did not
publish that fact, not that the answer is no — a third of the models in the catalog simply do not
state whether they support structured output.

The relative column divides each model's blended price by the cheapest one currently on screen, so
the cheapest always reads `1.0×` and the rest say how many times more they cost. It is computed over
what you can see: switching a provider off or typing in the search box moves the baseline, because a
multiple of a price that is not on screen would not mean anything. Models that are genuinely free
say **Free** rather than `0.0×`.

Press a row — or a card, on a narrow window — and the provider's own page for that model opens in
your browser, where the description, the licence and the vendor's own price live.

On a phone or a narrow window the ten columns become one card per model — the same information, laid
out to be read rather than scanned across.

## Where prices are kept

Fetched prices are cached on the daemon under `$PASEO_HOME/plugins/model-pricing/`, one small file
per upstream, and reused for twelve hours. **Refresh** ignores that and asks again. The refresh is
cheap: models.dev supports conditional requests, so an unchanged catalog costs a single round trip
rather than a 4.7 MB download.

If one upstream cannot be reached, the panel keeps showing the last prices it has for that source
with a note saying so and how old they are, and the other source's rows are unaffected.

## Limitations

- **The prices are only as current as their source.** models.dev is community-maintained, so a
  price change at Anthropic or OpenAI reaches this table when somebody updates the catalog, not when
  the vendor announces it. Each provider's own pricing page remains the authority; this table is for
  comparing, not for billing.
- **Only per-token prices are shown.** Cached input, batch discounts, image and audio pricing, and
  minimum charges are not in the table, so a model's real cost can be well below what the input
  column implies if you use prompt caching heavily.
- **A model that appears twice is not a bug.** With OpenRouter on, a model sold both directly and
  through the gateway is two rows with two prices, which is usually the comparison you wanted.
- **A model's link is worked out from its name**, because no catalog publishes one. It is right for
  every model in the table today, but a provider that retires a page or files a new model somewhere
  unexpected can leave a row pointing at a page that no longer exists.
- **"Ollama" here means Ollama Cloud**, the hosted models with real per-token prices — not the
  models pulled onto your own machine, which cost nothing to run and are not listed.
