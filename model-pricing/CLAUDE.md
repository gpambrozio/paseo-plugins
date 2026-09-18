# CLAUDE.md

A Paseo plugin that adds a **Model pricing** sidebar surface: one sortable table of what every model
on the enabled providers costs, ranked against the cheapest one on screen, plus a settings screen
choosing which providers are fetched and shown.

The repo root `CLAUDE.md` covers what every plugin here shares: the per-folder npm layout, the
typecheck/reload loop, the client/server bundle split, and the constraints nothing catches at
compile time. This file covers only what is specific to `model-pricing`.

## Orientation

| File                         | What it owns                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `index.server.ts`            | Wiring — one RPC, the display settings document, the cache flushed on cleanup.            |
| `index.client.tsx`           | Wiring — the surface, sidebar item, settings screen, two ⌘K items, the settings opener.   |
| `shared/providers.ts`        | The five providers and which of the two upstreams each is read from. Plain values.        |
| `shared/pricing.ts`          | `PriceRow`, the per-source status, and the `pricing.load` contract.                       |
| `shared/settings.ts`         | The host settings document: providers, the blend weight, the tool-call filter.            |
| `shared/format.ts`           | Every number the table prints, and the relative-cost ranking. Pure.                       |
| `shared/sort.ts`             | The column comparator. In `shared/` so it can be tested without a renderer.               |
| `server/normalize.ts`        | Each upstream's JSON → `PriceRow[]`. Pure, defensive, skips rather than throws.           |
| `server/sources.ts`          | The two HTTP fetches, `fetch` injected. ETag revalidation for models.dev.                 |
| `server/cache.ts`            | `$PASEO_HOME/plugins/model-pricing/<source>.json`, TTL and ETag.                          |
| `server/pricing.ts`          | The handler: which sources to fetch, cache or network, and what a failure returns.        |
| `client/pricing.tsx`         | The surface: header, legend, search, the module-scope cache, the filter/sort pipeline.    |
| `client/table.tsx`           | The wide table, the compact card, the sort comparator, and every style the surface uses.  |
| `client/settings-screen.tsx` | Settings › Plugins › Model pricing.                                                       |
| `server/*.test.ts`, `shared/*.test.ts` | The tests. `npm test`.                                                         |

`client/table.tsx` holds no logic worth testing on purpose: the comparator moved to
`shared/sort.ts` precisely because a module that imports React Native cannot be unit-tested here.

## Nobody sells a pricing API

This is the fact the whole plugin is shaped around, and it is worth not rediscovering:

- **Anthropic, OpenAI and Fireworks publish no prices programmatically.** Each has a `GET
  /v1/models`, each needs an API key, and none of the three returns a price. Verified 2026-09-18:
  `api.fireworks.ai/inference/v1/models` answers 401, and the other two carry ids and nothing about
  cost. Their prices exist only on HTML pricing pages.
- **models.dev is therefore the source for four of the five providers.** Its model shape happens to
  be exactly this table's columns — `limit.context`, `limit.output`, `cost.input`, `cost.output`,
  `reasoning`, `tool_call`, `structured_output`, `temperature` — which is why the table looks the
  way it does rather than the other way round.
- **`https://models.dev/api.json` is its only JSON endpoint.** The per-provider paths some of its
  docs describe (`/api/anthropic.json`) 302 to the homepage. One 4.7 MB document or nothing.
- **OpenRouter is read first-hand** because models.dev mirrors it a few dozen models behind — 371
  against 446 on the day this was written — and OpenRouter's own endpoint is unauthenticated and 75
  KB gzipped.

The catalog keys are not the provider ids: `fireworks-ai` and `ollama-cloud`. `shared/providers.ts`
holds the mapping and `server/normalize.ts` walks only the four it needs, not all 222 in the file.

## The 4.7 MB never reaches the cache or the wire

`server/cache.ts` stores normalized `PriceRow[]`, not the document they were parsed out of. That one
decision is why the cache files are tens of KB and why a `pricing.load` answer is small enough to
send to a phone. **Do not "simplify" this by caching the raw response** — it is the same mistake as
caching the whole board in github-board would be, an order of magnitude worse.

models.dev honours `If-None-Match` and answers **304**, so `fetchModelsDev` sends the stored ETag and
a refresh that changes nothing costs one round trip and no parse. On a 304 the handler keeps the rows
and *restamps* `fetchedAt`; without the restamp every mount past the TTL would revalidate again
forever. `fetchModelsDev` also falls back to the ETag it sent when a 304 does not repeat one —
losing it turns every later refresh back into a full download.

OpenRouter has no ETag and does not need one.

## A source that fails must not blank the table

`server/pricing.ts` settles each source on its own and returns its error **as a string beside the
rows**, never by throwing. Three cases, all of them real:

- one upstream down, the other fine → the other's rows are on screen under a banner;
- a refresh that fails with something cached → the stale rows come back with the *cache's*
  `fetchedAt`, so the surface can say how old they are;
- a failure with nothing cached → an empty table and the reason, logged once.

The handler also keeps one fetch per source in flight at a time, because four of the five providers
share the models.dev document and toggling providers quickly would otherwise download it repeatedly.
**A `refresh: true` deliberately bypasses that dedupe** — the user pressed Refresh because they
doubt what is on screen, and answering them with the in-flight load they already distrust is wrong.

## Absent is not false

Every capability on a `PriceRow` is `boolean | null`, and `null` means *the upstream did not say*.
models.dev omits `structured_output` for about a third of its models and `temperature` for a few
hundred; OpenRouter states capabilities only indirectly, through which request parameters a model
accepts. Both render as an em dash.

The filter follows the same rule: "only models that can call tools" drops `toolCall === false` and
**keeps `null`**, because hiding a model whose catalogue entry is merely quiet would lose real
models. The one thing a row may not lack is a price — a row with no price cannot be ranked, so
`normalize.ts` drops it rather than carrying a hole.

A malformed *model* is skipped; only a malformed *document* throws. With 7,850 models in the
catalog, one upstream typo must not empty the table.

## The relative column is a setting, not a formula

`relativeCosts` blends input and output into one number and divides by the cheapest, so the cheapest
reads `1.0×`. Two things about it are deliberate:

- **The blend weight is a user setting** (`INPUT_WEIGHTS`). There is no neutral answer: an agent
  reading a repository and writing a patch is mostly input, a chat drafting prose is mostly output,
  and models genuinely reorder between the two. Shipping a constant would be asserting one workload.
- **The baseline is the cheapest *visible* row**, computed in the client over the filtered set, not
  over the catalog. Switching a provider off or typing in the search box moves it, on purpose: a
  multiple of a price the user cannot see means nothing.

Free models keep a blend of 0, are excluded from the baseline search, and print **Free** rather than
`0.0×` — OpenRouter carries a couple of dozen of them, and `0.0×` under a header promising
"cheapest = 1.0×" reads as a bug. They keep their 0 **even when no paid row is visible**: searching
"free" narrows the table to exactly that set, and mapping the lot to 1 put `1.0×` on every row.

The map is keyed `providerId/modelId`, because a model id is unique only within a provider and the
same model is two rows when OpenRouter is on.

## Settings are client-only, and that is the whole design

Everything the user picks is drawn and nothing is read by the daemon, so the whole of
`shared/settings.ts` is a host settings document and there is no config RPC — unlike herald, which
needs both.

"Which providers to refresh" and "which providers to show" are the same switch: the surface passes
the enabled ids into `pricing.load`, so a provider switched off is genuinely not fetched. That is
what makes a daemon-side copy of the list unnecessary. **Do not add one.** The cost is that four of
the five providers share one fetch, so switching Anthropic off saves nothing until OpenAI, Fireworks
and Ollama Cloud are off too; `sourcesFor` is where that is decided.

The sort, the search box and the legend's hidden set are *not* settings. They live in module scope
next to the cached rows, because writing the settings document on every column press would be
chatty and none of the three is worth persisting.

**The legend dots and the settings switches are deliberately different controls**, and merging them
would break both:

- A **settings switch** decides what is *fetched*. Off means the provider is not in the RPC.
- A **legend dot** decides what is *drawn*, over the fetched set. Hiding is instant and costs no
  network, and the provider is still there to bring back.

Wiring a dot to the settings list would be self-defeating: the legend only draws enabled providers,
so the first tap would remove the very dot needed to undo it. The two do have to talk in one
direction — a provider switched off in settings is pruned from the hidden set, so switching it back
on does not return it still hidden, which would read as the switch being broken.

## Ten columns do not fit a phone

There is no table primitive in React Native or in the host kit, and `layout` tells a plugin only
whether it is `compact` — never how wide it is. So columns are `flex` weights, and `compact` gets
`PricingCard`, a card per model, rather than a squeezed grid or a horizontally scrolling one.

The rows are a `FlatList` because there are over five hundred of them with every provider on. The
column headings are its `ListHeaderComponent` with `stickyHeaderIndices={[0]}`, so a price three
hundred rows down is still readable as a price.

`useStyles` in `client/table.tsx` is the whole surface's styling, including the settings screen's
neighbours; `withAlpha` derives separators from `foregroundMuted`.

## Provider colours are a palette, and that is on purpose

**`shared/providers.ts` is the one place here that does not take a colour from `theme.colors`**, and
it is a considered exception to the root CLAUDE.md's rule rather than an oversight. That rule's
stated reason is that an invented *token name* resolves to `undefined` at runtime; a hex string is
not a token name, and `withAlpha` already computes colour strings in this repo and in launchd-jobs.

A token genuinely cannot do this job:

- Four of the eleven tokens are hues at all — `accent`, `statusSuccess`, `statusWarning`,
  `statusDanger` — for five providers.
- They are not guaranteed to differ. In Paseo's default dark theme **`accent` is green**, so the
  first cut put OpenAI on `statusSuccess` and Ollama Cloud on `accent` and shipped two providers the
  user could not tell apart. `shared/providers.test.ts` asserts all five are distinct now, in both
  variants; that test exists because of this bug.
- The status tokens mean something. Painting Anthropic "danger" is a sentence about Anthropic.

So each provider carries a `ProviderAccent`, a `{ dark, light }` pair of the same hue at two
lightnesses, with the five hues spread around the wheel — orange, green, violet, blue, pink.
`pickAccent` chooses between them using `isDarkBackground(theme.colors.surface0)`, because
`PluginTheme` carries colours and **no `appearance` flag**, so the background is the only evidence
available of which theme is painting. Both helpers are pure and in `shared/`, so they are tested.

Adding a sixth provider means adding a sixth hue pair, and checking it against the other five on
both backgrounds. Do not reach for a token.

## Checking it

`npm test` covers everything that does not need a network: the formatters and the ranking, both
normalizers against trimmed copies of real upstream responses, the cache's TTL, ETag and corrupt-file
behaviour, and the handler's arbitration through a fake `fetch`.

What it cannot cover, check by hand after `paseo plugin reload model-pricing`:

1. Open the panel. Rows appear for every provider that is on; the header says how long ago they were
   fetched. `paseo plugin logs model-pricing` shows any fetch failure.
2. Press Refresh. The second press should be fast — that is the 304 — and the header should say
   "just now".
3. Switch OpenRouter off in settings and come back: about four hundred rows disappear and the
   relative baseline moves, because it is computed over what is visible.
4. Change the blend to 25/75 and watch the order change. Change it to 100 and the ranking is input
   price alone.
5. Tap column headings to sort, and tap the same one again to reverse it. Leave the panel and come
   back: the sort and the search text should still be there, and the table should paint without a
   spinner.
6. Check a narrow window for the card layout, and switch theme.

To check the server half against reality rather than fixtures, write a throwaway `*.tmp.test.ts` that
builds a `PricingCache` on a `mkdtemp` directory, calls `createPricingHandler` with the real deps,
prints the rows, and then delete it. That is how the row counts in this file were taken.
