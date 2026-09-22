# Changelog

Notable changes to `model-pricing`. The other plugins in this repository version separately.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every version is published to npm
as `@gpambrozio/paseo-model-pricing` and tagged here, so a version is something to install and a
line to read before you move.

## [0.3.0] — 2026-09-22

### Added

- **A one-line description of the plugin**, shown next to it in Paseo's plugins list, so it is
  clear what it does without opening it.

### Changed

- **Paseo 0.9 or newer is now required.** On 0.8 this version will not load. Staying on 0.8 means
  staying on the previous release, which keeps working.

## [0.2.0] — 2026-09-21

### Added

- **Every row is a link.** Press a model — a row on a wide panel, a card on a narrow one — and its
  provider's own page for that model opens in your browser, so the description, the licence and the
  vendor's own price are one press away from the table. Anthropic, OpenAI, Fireworks AI, Ollama
  Cloud and OpenRouter all have one. A handful of models their vendors have not published a page
  for open the provider's model list instead.

## [0.1.2] — 2026-09-19

### Fixed

- **Loads on Paseo 0.8 again.** 0.8 rejects any manifest key it does not recognise, and the
  previous release added one, so the plugin refused to load there at all. On 0.9 and newer nothing
  was wrong and nothing changes now.

## [0.1.1] — 2026-09-19

### Added

- **Installs from npm.** On Paseo 0.9 and newer,
  `paseo plugin install npm:@gpambrozio/paseo-model-pricing` fetches the plugin from the npm
  registry — no clone, no repository path to remember. Installing from this repository keeps
  working, and nothing about what the plugin does has changed.

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
