/**
 * The Model pricing surface: one table of what every model on the enabled
 * providers costs, ranked against the cheapest one on screen.
 *
 * Three things about it are forced by the plugin API rather than chosen:
 *
 * - **The rows live at module scope.** A surface is unmounted the moment the
 *   user navigates to a workspace and mounted fresh on the way back, so
 *   component state is gone. Keeping the last table here means a return visit
 *   paints immediately and only refetches once the data has aged out.
 * - **The gear is lent from the entry.** `PluginSurfaceProps` carries no
 *   `openSettings`, so `index.client.tsx` hands one to `bindSettingsOpener` and
 *   the button hides while nothing is bound.
 * - **No async arrows.** Hermes evaluates one in the eval'd client bundle to
 *   `undefined`, with no error until something calls it. Async *function
 *   expressions* are fine, and are what every callback here is.
 */
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { FlatList, Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { PricingCard, TableBodyRow, TableHeader, accentColor, tableRowKey, useStyles, type Styles } from "./table";
import { compareRows, type Sort, type SortKey, type TableRow } from "../shared/sort";
import { relativeCosts, relativeTime, rowKey } from "../shared/format";
import { loadPricing, type PriceRow, type SourceStatus } from "../shared/pricing";
import { PROVIDERS, providerLabel } from "../shared/providers";
import {
  DEFAULT_DISPLAY,
  displaySettings,
  inputShare,
  type DisplaySettings,
  type InputWeight,
} from "../shared/settings";

/**
 * Survives the surface being unmounted; dies with the app. None of it is worth
 * persisting — the rows are cached on the daemon already, and the sort and the
 * search box are this session's business.
 */
let cachedRows: PriceRow[] | null = null;
let cachedSources: SourceStatus[] = [];
let cachedFetchedAt = 0;
/** Which providers the cached rows were fetched for, so a toggle refetches. */
let cachedProviderKey = "";
let cachedSort: Sort = { key: "relative", descending: true };
let cachedSearch = "";
/**
 * Providers hidden by tapping their legend dot.
 *
 * Deliberately *not* the `providers` list in the settings document, which is a
 * different question: that one decides what is fetched, and a provider dropped
 * from it also drops out of the legend — leaving no dot to tap to bring it
 * back. This is the cheap view filter layered over it, so a hidden provider is
 * still fetched and reappears instantly. Module scope, like the sort and the
 * search text, because it is this session's business and not worth persisting.
 */
let cachedHidden: ReadonlySet<string> = new Set();

/** Past this, a mount refetches — underneath the table already on screen. */
const STALE_AFTER_MS = 30 * 60_000;

/** Lent by `index.client.tsx`; null whenever no client entry is live. */
let openSettingsScreen: ((id: string) => void) | null = null;

export function bindSettingsOpener(open: ((id: string) => void) | null): void {
  openSettingsScreen = open;
}

function providerKeyOf(providerIds: readonly string[]): string {
  return [...providerIds].sort().join(",");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * When the prices on screen were actually fetched — the *oldest* source, since
 * that is the one the "updated" line is really about.
 *
 * Not the clock when the RPC returned. A cached answer comes back in
 * milliseconds and its rows can be twelve hours old, so stamping the reply
 * would have the header say "just now" over half-day-old prices, which is the
 * one thing that line exists to prevent. Sources that never loaded report 0 and
 * are ignored; if none of them has a stamp, the reply time is all there is.
 */
function stampOf(sources: readonly SourceStatus[]): number {
  const stamps = sources.map((source) => source.fetchedAt).filter((stamp) => stamp > 0);
  return stamps.length === 0 ? Date.now() : Math.min(...stamps);
}

export function PricingSurface(props: PluginSurfaceProps) {
  const { theme, layout } = props;
  const styles = useStyles(props);
  const settings = useSettings(displaySettings);
  const load = useRpc(loadPricing);

  /**
   * Settings that failed to load fall back to the defaults rather than blocking
   * the table: a broken settings document should cost the user their choices,
   * not the whole panel. `null` means still loading, and nothing is fetched yet.
   */
  const display = useMemo((): DisplaySettings | null => {
    if (settings.status === "ready") return settings.values;
    if (settings.status === "loading") return null;
    return DEFAULT_DISPLAY;
  }, [settings]);

  /**
   * Everything downstream is keyed on *primitives* pulled out of the settings
   * document, never on the document itself. `useSettings` is implemented by the
   * host, not by anything in this repo, so it promises no stable object
   * identity between renders — and a fetch effect that depended on one would
   * re-run on every render, each render starting a fetch that causes the next.
   * A joined string cannot do that.
   */
  const settingsReady = display !== null;
  // Built from the providers this build knows about, not from the raw stored
  // list, so an id left behind by a removed provider cannot make the key
  // disagree with the ids actually sent to the daemon.
  const providerKey = providerKeyOf(PROVIDERS.filter((provider) => (display?.providers ?? []).includes(provider.id)).map((provider) => provider.id));
  const toolCallOnly = display?.toolCallOnly ?? DEFAULT_DISPLAY.toolCallOnly;
  const inputWeight = display?.inputWeight ?? DEFAULT_DISPLAY.inputWeight;

  /** Enabled ids the current build actually knows about, in catalog order. */
  const enabled = useMemo(() => {
    const chosen = new Set(providerKey.split(",").filter((id) => id !== ""));
    return PROVIDERS.filter((provider) => chosen.has(provider.id));
  }, [providerKey]);
  const enabledIds = useMemo(() => enabled.map((provider) => provider.id), [enabled]);

  const [rows, setRows] = useState<PriceRow[] | null>(cachedRows);
  const [sources, setSources] = useState<SourceStatus[]>(cachedSources);
  const [fetchedAt, setFetchedAt] = useState(cachedFetchedAt);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearchState] = useState(cachedSearch);
  const [sort, setSortState] = useState<Sort>(cachedSort);
  const [hidden, setHiddenState] = useState<ReadonlySet<string>>(cachedHidden);

  const toggleHidden = useCallback((providerId: string) => {
    setHiddenState((current) => {
      const next = new Set(current);
      if (!next.delete(providerId)) next.add(providerId);
      cachedHidden = next;
      return next;
    });
  }, []);

  const setSearch = useCallback((next: string) => {
    cachedSearch = next;
    setSearchState(next);
  }, []);

  const onSort = useCallback((key: SortKey) => {
    setSortState((current) => {
      // Same column flips direction; a new column starts on the order that
      // reads as "most interesting first" for that kind of value.
      const next: Sort =
        current.key === key ? { key, descending: !current.descending } : { key, descending: key !== "name" && key !== "provider" };
      cachedSort = next;
      return next;
    });
  }, []);

  /**
   * Which request is the current one. Two loads overlap whenever a provider is
   * toggled while the first is still in flight, and the 4.7 MB models.dev fetch
   * makes that window real — without this, the older answer could land last and
   * put back rows for a provider the user has just switched off.
   */
  const latestRequest = useRef(0);

  const refresh = useCallback(
    async function refresh(providerIds: readonly string[], force: boolean) {
      const request = latestRequest.current + 1;
      latestRequest.current = request;
      setBusy(true);
      setError(null);
      try {
        const result = await load({ providers: [...providerIds], refresh: force });
        if (latestRequest.current !== request) return;
        cachedRows = result.rows;
        cachedSources = result.sources;
        cachedFetchedAt = stampOf(result.sources);
        cachedProviderKey = providerKeyOf(providerIds);
        setRows(result.rows);
        setSources(result.sources);
        setFetchedAt(cachedFetchedAt);
      } catch (cause) {
        if (latestRequest.current !== request) return;
        setError(errorText(cause));
      } finally {
        if (latestRequest.current === request) setBusy(false);
      }
    },
    [load],
  );

  /**
   * The provider set this mount has already asked the daemon about. Without it,
   * a fetch that fails — or simply the re-render its own `busy` flag causes —
   * would look like a fresh set of providers and start another fetch.
   */
  const requestedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!settingsReady) return;
    if (providerKey === "") {
      // Nothing to ask the daemon for. Clear rather than leave another
      // provider's rows on screen under an empty legend.
      if (requestedKey.current === "") return;
      requestedKey.current = "";
      cachedRows = [];
      cachedProviderKey = "";
      setRows([]);
      setSources([]);
      return;
    }
    // A warm cache for the same providers repaints on its own; refetching is
    // only worth two HTTP round trips once it has aged out.
    const warm = cachedRows !== null && cachedProviderKey === providerKey && Date.now() - cachedFetchedAt < STALE_AFTER_MS;
    if (warm || requestedKey.current === providerKey) {
      requestedKey.current = providerKey;
      return;
    }
    requestedKey.current = providerKey;
    void refresh(enabledIds, false);
  }, [settingsReady, providerKey, enabledIds, refresh]);

  useEffect(() => {
    // Not before the settings are in. While they load, `providerKey` is "" —
    // indistinguishable from "every provider is switched off" — and pruning
    // against that emptied the hidden set on every single mount, which is
    // exactly what the module-scope cache exists to prevent.
    if (!settingsReady) return;
    // Forget a provider that has since been switched off in settings, so that
    // switching it back on does not bring it back still hidden — which would
    // read as the switch not working.
    setHiddenState((current) => {
      const allowed = new Set(providerKey.split(",").filter((id) => id !== ""));
      const next = new Set([...current].filter((id) => allowed.has(id)));
      if (next.size === current.size) return current;
      cachedHidden = next;
      return next;
    });
  }, [settingsReady, providerKey]);

  // ---- the visible set ----------------------------------------------------

  const visible = useMemo((): TableRow[] => {
    if (rows === null) return [];
    const terms = search.toLowerCase().split(/\s+/).filter((term) => term !== "");
    const shown = new Set(enabledIds);
    const filtered = rows.filter((row) => {
      // Belt as well as braces: the daemon is asked only for enabled providers,
      // but `rows` is whatever the last answer carried, and that answer can be
      // older than the switch the user just flipped. Rows for a provider that
      // is off have no legend dot to hide them and would drag the relative
      // baseline, so they are dropped here regardless of which reply landed.
      if (!shown.has(row.providerId)) return false;
      // Tapped off in the legend. Checked first among the user's own filters
      // because it is the cheapest test and the one most likely to reject.
      if (hidden.has(row.providerId)) return false;
      // Unknown is not hidden. `null` means the upstream did not say whether
      // the model calls tools, and dropping it would lose models whose
      // catalogue entry is merely quiet rather than negative.
      if (toolCallOnly && row.toolCall === false) return false;
      if (terms.length === 0) return true;
      const haystack = `${row.name} ${row.modelId} ${providerLabel(row.providerId)}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });

    // Ranked against what is on screen, not the whole catalog: "1.0×" has to
    // mean the cheapest row the user can actually see.
    const relatives = relativeCosts(filtered, inputShare(inputWeight));
    const entries = filtered.map((row) => ({ row, relative: relatives.get(rowKey(row)) ?? 1 }));
    return entries.sort((a, b) => compareRows(a, b, sort));
  }, [rows, search, sort, toolCallOnly, inputWeight, hidden, enabledIds]);

  const failures = sources.filter((source) => source.error !== null);
  const openSettings = openSettingsScreen;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Model pricing</Text>
        <View style={styles.spacer} />
        {openSettings === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Model pricing settings"
            onPress={() => openSettings("model-pricing")}
            style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
          >
            <Icon name="Settings" size={15} color={theme.colors.foreground} />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? "Loading prices" : "Refresh prices"}
          disabled={busy || enabledIds.length === 0}
          onPress={() => void refresh(enabledIds, true)}
          style={({ pressed }) => [styles.refresh, pressed ? styles.pressed : null]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.colors.accentForeground} />
          ) : (
            <Icon name="RefreshCw" size={13} color={theme.colors.accentForeground} />
          )}
          <Text style={styles.refreshLabel}>Refresh</Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle}>{subtitle(inputWeight, toolCallOnly, fetchedAt, rows)}</Text>

      <View style={styles.legend}>
        {enabled.map((provider) => {
          const off = hidden.has(provider.id);
          const color = accentColor(theme, provider.accent);
          return (
            <Pressable
              key={provider.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !off }}
              accessibilityLabel={provider.label}
              accessibilityHint={off ? `Show ${provider.label} models` : `Hide ${provider.label} models`}
              // The dot is 10px across; the finger aiming at it is not.
              hitSlop={10}
              onPress={() => toggleHidden(provider.id)}
              style={({ pressed }) => [styles.legendItem, pressed ? styles.pressed : null]}
            >
              <View
                style={[
                  styles.legendDot,
                  // Hollow when off. The provider keeps its colour either way,
                  // so the dot still says which provider it is and only the
                  // fill reports the state.
                  off ? [styles.legendDotOff, { borderColor: color }] : { backgroundColor: color },
                ]}
              />
              <Text style={[styles.legendLabel, off ? styles.legendLabelOff : null]}>{provider.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search models and providers"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search models and providers"
      />

      {error === null ? null : (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}
      {failures.length === 0 ? null : (
        <View style={styles.banner}>
          {failures.map((source) => (
            <Text key={source.id} style={styles.bannerText}>
              {source.error}
              {source.fetchedAt > 0 ? ` Showing prices from ${relativeTime(source.fetchedAt)}.` : ""}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.table}>
        <FlatList<TableRow>
          data={visible}
          keyExtractor={tableRowKey}
          keyboardShouldPersistTaps="handled"
          // The column headings scroll with nothing; they stay put so a price
          // 300 rows down is still readable as a price.
          ListHeaderComponent={
            layout.compact ? null : <TableHeader styles={styles} sort={sort} onSort={onSort} />
          }
          stickyHeaderIndices={layout.compact ? undefined : [0]}
          ListEmptyComponent={
            <EmptyState styles={styles} busy={busy} enabled={enabledIds.length} hidden={hidden.size} rows={rows} />
          }
          ListFooterComponent={<View style={styles.pad} />}
          renderItem={({ item }) =>
            layout.compact ? (
              <PricingCard entry={item} styles={styles} theme={theme} />
            ) : (
              <TableBodyRow entry={item} styles={styles} theme={theme} />
            )
          }
        />
      </View>
    </View>
  );
}

function EmptyState({
  styles,
  busy,
  enabled,
  hidden,
  rows,
}: {
  styles: Styles;
  busy: boolean;
  enabled: number;
  hidden: number;
  rows: PriceRow[] | null;
}) {
  if (enabled === 0) return <Text style={styles.empty}>No providers are switched on. Pick some in settings.</Text>;
  if (busy && rows === null) return <Text style={styles.empty}>Loading prices…</Text>;
  if (rows === null) return <Text style={styles.empty}>No prices loaded yet.</Text>;
  // Worth saying outright: an empty table under a full legend of hollow dots
  // otherwise looks like the fetch failed.
  if (hidden >= enabled) return <Text style={styles.empty}>Every provider is hidden. Tap a dot to bring one back.</Text>;
  return <Text style={styles.empty}>Nothing matches.</Text>;
}

/**
 * The line under the title, which is where the table says what it is measuring.
 * The weighting belongs here because the relative column is meaningless without
 * it, and the fetch time because a stale cache and a live fetch look identical.
 */
function subtitle(inputWeight: InputWeight, toolCallOnly: boolean, fetchedAt: number, rows: PriceRow[] | null): string {
  const weight = Number(inputWeight);
  const parts = [
    toolCallOnly ? "Agent-capable models" : "All models",
    `${weight}/${100 - weight} input:output blend`,
    "cheapest = 1.0×",
    "USD per 1M tokens",
  ];
  if (rows !== null && fetchedAt > 0) parts.push(`updated ${relativeTime(fetchedAt)}`);
  return parts.join(" · ");
}
