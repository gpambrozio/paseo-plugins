# Changelog

Notable changes to `model-pricing`. The other plugins in this repository version separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Nothing here is published to a
registry: `paseo plugin add` follows a branch unless you pin `--ref <tag>`, so a version is a tag to
pin and a line to read before you move.

## [0.1.0] — 2026-09-18

### Added

- **A Model pricing panel in the sidebar**, listing what every model on the providers you follow
  costs per million tokens, beside its context window, how much it can write in one go, and whether
  it can reason, call tools, return structured output and take a temperature. Anthropic, OpenAI,
  Fireworks AI, Ollama Cloud and OpenRouter, all without an API key.
- **A relative-cost column** that blends each model's input and output price into one number and
  measures it against the cheapest model on screen, so you can see at a glance that one model costs
  fifty times another rather than working it out from four figures. Genuinely free models say so
  instead of being ranked.
- **Sorting and search.** Tap a column heading to sort by it, tap again to reverse, and type in the
  search box to narrow the list to a model or a provider. A sort survives leaving the panel and
  coming back.
- **Tap a coloured dot to hide that provider** and tap it again to bring it back, for narrowing the
  table while you compare two of them. It is instant, and unlike switching a provider off in
  settings it keeps the prices loaded.
- **Settings**, under Settings › Plugins › Model pricing: which providers to follow, whether to hide
  models that cannot call tools, and how much of the relative-cost blend is input rather than
  output — an agent reading a repository and writing a patch is mostly input, a chat drafting prose
  is mostly output, and the ranking really does change between the two.
- **Prices are kept for half a day** and refreshed on demand with the Refresh button, so opening the
  panel is instant and does not go to the network every time. If one provider's prices cannot be
  fetched, the rest of the table still works and a note says which one is stale and how old it is.
