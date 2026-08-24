import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Board, BoardColumn, BoardItem } from "./board.shared";
import { loadBoard, saveLogin, saveRepositoryFilter } from "./board.shared";

/**
 * `Linking.openURL` is `window.open` on the desktop renderer, and the main
 * Electron window installs no window-open handler, so a card click lands in a
 * bare child window instead of the browser. The desktop preload exposes the
 * same opener Paseo's own links go through, which hands the URL to the OS
 * browser as a normal tab. Mobile and plain web have no bridge and keep
 * `Linking`, which already opens a tab there.
 */
interface DesktopOpenerBridge {
  readonly opener?: { readonly openUrl?: (url: string) => Promise<void> };
}

function openExternalUrl(url: string): void {
  const openUrl = (globalThis as { paseoDesktop?: DesktopOpenerBridge }).paseoDesktop?.opener
    ?.openUrl;
  if (typeof openUrl !== "function") {
    void Linking.openURL(url);
    return;
  }
  void openUrl(url).catch((error: unknown) => {
    console.warn("[github-board] desktop opener refused the URL, falling back", error);
    void Linking.openURL(url);
  });
}

/** Width of one column when columns scroll horizontally instead of sharing the row. */
const COMPACT_COLUMN_WIDTH = 300;

/**
 * Switching workspaces unmounts this surface and mounting it again used to cost
 * three `gh` subprocesses before anything rendered. The last board is kept at
 * module scope instead, which outlives the component and dies with the app, so
 * a return visit paints immediately and only re-fetches once the data has aged
 * past `STALE_AFTER_MS` — and even then the stale board stays on screen while
 * the refresh runs.
 *
 * The server still owns the durable copy of the filter; `cachedHidden` is only
 * here because a toggle made after the last load would otherwise be undone by
 * rehydrating from a board fetched before it.
 */
let cachedBoard: Board | null = null;
let cachedFetchedAt = 0;
let cachedHidden: ReadonlySet<string> | null = null;

const STALE_AFTER_MS = 5 * 60_000;

/**
 * The theme exposes six opaque tokens and no border or hover colour, so
 * separators are the muted foreground at low opacity. Tokens are documented as
 * hex, but a theme that contributes anything else is passed through untouched
 * rather than turned into an invalid colour string.
 */
function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function useStyles({ theme, layout }: PluginSurfaceProps) {
  return useMemo(() => {
    const { colors } = theme;
    const gap = layout.compact ? 8 : 12;
    const separator = withAlpha(colors.foregroundMuted, "33");
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap,
        paddingHorizontal: layout.compact ? 12 : 20,
        paddingVertical: layout.compact ? 10 : 14,
        borderBottomWidth: 1,
        borderBottomColor: separator,
        // The repository dropdown escapes the header, so the header has to
        // out-stack the columns it overlaps.
        zIndex: 30,
      },
      title: {
        color: colors.foreground,
        fontSize: layout.compact ? 17 : 20,
        fontWeight: "600" as const,
      },
      headerSpacer: { flex: 1 },
      subtle: { color: colors.foregroundMuted, fontSize: 12 },
      loginInput: {
        color: colors.foreground,
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        fontSize: 13,
        minWidth: 140,
      },
      button: {
        backgroundColor: colors.accent,
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
      },
      buttonLabel: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
      ghostButton: {
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
      },
      ghostButtonLabel: { color: colors.foreground, fontSize: 13 },
      filterAnchor: { position: "relative" as const },
      dropdown: {
        position: "absolute" as const,
        top: "100%" as const,
        left: 0,
        marginTop: 4,
        minWidth: 220,
        maxHeight: 320,
        backgroundColor: colors.surface0,
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 8,
        overflow: "hidden" as const,
      },
      dropdownActions: {
        flexDirection: "row" as const,
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: separator,
      },
      chipButton: {
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 3,
      },
      chipLabel: { color: colors.foreground, fontSize: 12 },
      dropdownList: { paddingVertical: 4 },
      dropdownRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
      },
      checkbox: {
        width: 14,
        height: 14,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: separator,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
      checkmark: {
        color: colors.accentForeground,
        fontSize: 9,
        lineHeight: 12,
        fontWeight: "700" as const,
      },
      dropdownLabel: { color: colors.foreground, fontSize: 12 },
      backdrop: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
      },
      banner: {
        paddingHorizontal: layout.compact ? 12 : 20,
        paddingVertical: 10,
      },
      danger: { color: colors.statusDanger, fontSize: 13 },
      centered: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
      columns: { flexDirection: "row" as const, flex: 1, gap },
      columnsContent: { padding: gap, gap },
      column: {
        flex: layout.compact ? undefined : 1,
        width: layout.compact ? COMPACT_COLUMN_WIDTH : undefined,
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 10,
        overflow: "hidden" as const,
      },
      columnHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: separator,
      },
      columnTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
      countPill: {
        color: colors.foregroundMuted,
        fontSize: 12,
        overflow: "hidden" as const,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: withAlpha(colors.foregroundMuted, "22"),
      },
      columnBody: { padding: 8, gap: 8 },
      card: {
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 8,
        padding: 10,
        gap: 6,
      },
      cardPressed: { backgroundColor: withAlpha(colors.foregroundMuted, "1a") },
      cardRepo: { color: colors.foregroundMuted, fontSize: 11 },
      cardTitle: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
      cardFooter: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 6,
      },
      label: {
        color: colors.foregroundMuted,
        fontSize: 10,
        overflow: "hidden" as const,
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderWidth: 1,
        borderColor: separator,
      },
      empty: { color: colors.foregroundMuted, fontSize: 12, padding: 12 },
    };
  }, [theme, layout.compact]);
}

type Styles = ReturnType<typeof useStyles>;

/**
 * Repository filter. The selection is held as the set of *hidden* repositories
 * rather than the visible ones, so a repository that only shows up on a later
 * refresh — or that the saved filter has never seen — arrives selected, which
 * is what "starts with all repos selected" means once the board can change
 * under the filter.
 */
function RepoFilter({
  repositories,
  hidden,
  open,
  styles,
  onToggleOpen,
  onToggleRepo,
  onSelectAll,
  onSelectNone,
}: {
  repositories: readonly string[];
  hidden: ReadonlySet<string>;
  open: boolean;
  styles: Styles;
  onToggleOpen: () => void;
  onToggleRepo: (repository: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  const selected = repositories.filter((repository) => !hidden.has(repository)).length;
  const allSelected = selected === repositories.length;

  return (
    <View style={styles.filterAnchor}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filter repositories: ${selected} of ${repositories.length} shown`}
        accessibilityState={{ expanded: open }}
        style={styles.ghostButton}
        onPress={onToggleOpen}
      >
        <Text style={styles.ghostButtonLabel}>
          {allSelected ? "All repos" : `${selected}/${repositories.length} repos`} ▾
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.dropdown}>
          <View style={styles.dropdownActions}>
            <Pressable style={styles.chipButton} onPress={onSelectAll}>
              <Text style={styles.chipLabel}>All</Text>
            </Pressable>
            <Pressable style={styles.chipButton} onPress={onSelectNone}>
              <Text style={styles.chipLabel}>None</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.dropdownList}>
            {repositories.map((repository) => {
              const checked = !hidden.has(repository);
              return (
                <Pressable
                  key={repository}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  onPress={() => onToggleRepo(repository)}
                  style={({ pressed }) => [styles.dropdownRow, pressed ? styles.cardPressed : null]}
                >
                  <View style={[styles.checkbox, checked ? styles.checkboxChecked : null]}>
                    {checked ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <Text style={styles.dropdownLabel} numberOfLines={1}>
                    {repository}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function Card({ item, styles }: { item: BoardItem; styles: Styles }) {
  const open = useCallback(() => {
    openExternalUrl(item.url);
  }, [item.url]);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${item.repository} #${item.number}: ${item.title}`}
      onPress={open}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      <Text style={styles.cardRepo} numberOfLines={1}>
        {item.repository} #{item.number}
      </Text>
      <Text style={styles.cardTitle} numberOfLines={3}>
        {item.title}
      </Text>
      <View style={styles.cardFooter}>
        <Text style={styles.subtle}>{relativeTime(item.updatedAt)}</Text>
        {item.commentsCount > 0 ? (
          <Text style={styles.subtle}>{item.commentsCount} comments</Text>
        ) : null}
        {item.detail !== null ? <Text style={styles.label}>{item.detail}</Text> : null}
        {item.labels.slice(0, 3).map((label) => (
          <Text key={label} style={styles.label}>
            {label}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

function Column({ column, styles }: { column: BoardColumn; styles: Styles }) {
  return (
    <View style={styles.column}>
      <View style={styles.columnHeader}>
        <Text style={styles.columnTitle}>{column.title}</Text>
        <Text style={styles.countPill}>{column.items.length}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.columnBody}>
        {column.error !== null ? (
          <Text style={styles.danger}>{column.error}</Text>
        ) : column.items.length === 0 ? (
          <Text style={styles.empty}>Nothing here.</Text>
        ) : (
          column.items.map((item) => <Card key={item.id} item={item} styles={styles} />)
        )}
      </ScrollView>
    </View>
  );
}

export function GitHubBoard(props: PluginSurfaceProps) {
  const styles = useStyles(props);
  const load = useRpc(loadBoard);
  const persistLogin = useRpc(saveLogin);
  const persistFilter = useRpc(saveRepositoryFilter);

  const [board, setBoard] = useState<Board | null>(cachedBoard);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(cachedBoard === null);
  const [loginDraft, setLoginDraft] = useState(cachedBoard?.login ?? "");
  const [hiddenRepos, setHiddenRepos] = useState<ReadonlySet<string>>(
    () => cachedHidden ?? new Set(),
  );
  const [filterOpen, setFilterOpen] = useState(false);
  /**
   * The saved filter is adopted on the first load only. Later refreshes must not
   * overwrite what the user is toggling right now with the value the server last
   * heard — and a remount that already restored the filter from cache counts as
   * hydrated.
   */
  const filterHydrated = useRef(cachedHidden !== null);

  const refresh = useCallback(
    async (login?: string, force = false) => {
      setBusy(true);
      setError(null);
      try {
        const next = await load(login === undefined ? { force } : { login, force });
        cachedBoard = next;
        cachedFetchedAt = Date.now();
        setBoard(next);
        setLoginDraft(next.login);
        if (!filterHydrated.current) {
          filterHydrated.current = true;
          const restored = new Set(next.hiddenRepositories);
          cachedHidden = restored;
          setHiddenRepos(restored);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  useEffect(() => {
    // A cached board renders straight away. Fetching again is only worth three
    // `gh` calls once it has aged out, and that refresh runs underneath the
    // board already on screen rather than behind a spinner.
    if (cachedBoard !== null && Date.now() - cachedFetchedAt < STALE_AFTER_MS) return;
    void refresh();
  }, [refresh]);

  /** Every repository with a card in any column, whether or not it is filtered out. */
  const repositories = useMemo(() => {
    const seen = new Set<string>();
    for (const column of board?.columns ?? []) {
      for (const item of column.items) {
        if (item.repository !== "") seen.add(item.repository);
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [board]);

  const columns = useMemo(() => {
    if (board === null) return [];
    if (hiddenRepos.size === 0) return board.columns;
    return board.columns.map((column) => ({
      ...column,
      items: column.items.filter((item) => !hiddenRepos.has(item.repository)),
    }));
  }, [board, hiddenRepos]);

  /** Applies a selection locally and saves it, so it survives the next unmount. */
  const commitHidden = useCallback(
    (next: ReadonlySet<string>) => {
      cachedHidden = next;
      setHiddenRepos(next);
      persistFilter({ hiddenRepositories: [...next] }).catch((cause: unknown) => {
        setError(
          `Repository filter could not be saved: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      });
    },
    [persistFilter],
  );

  const toggleRepo = useCallback(
    (repository: string) => {
      const next = new Set(hiddenRepos);
      if (!next.delete(repository)) next.add(repository);
      commitHidden(next);
    },
    [commitHidden, hiddenRepos],
  );

  const selectAllRepos = useCallback(() => {
    commitHidden(new Set());
  }, [commitHidden]);

  const selectNoRepos = useCallback(() => {
    commitHidden(new Set(repositories));
  }, [commitHidden, repositories]);

  const applyLogin = useCallback(async () => {
    const trimmed = loginDraft.trim();
    if (trimmed === "" || trimmed === board?.login) return;
    try {
      const { login } = await persistLogin({ login: trimmed });
      await refresh(login);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [board?.login, loginDraft, persistLogin, refresh]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>GitHub</Text>
        <TextInput
          style={styles.loginInput}
          value={loginDraft}
          onChangeText={setLoginDraft}
          onSubmitEditing={() => void applyLogin()}
          placeholder="github login"
          placeholderTextColor={props.theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
        />
        <Pressable style={styles.ghostButton} onPress={() => void applyLogin()}>
          <Text style={styles.ghostButtonLabel}>Set</Text>
        </Pressable>
        {repositories.length > 0 ? (
          <RepoFilter
            repositories={repositories}
            hidden={hiddenRepos}
            open={filterOpen}
            styles={styles}
            onToggleOpen={() => setFilterOpen((open) => !open)}
            onToggleRepo={toggleRepo}
            onSelectAll={selectAllRepos}
            onSelectNone={selectNoRepos}
          />
        ) : null}
        <View style={styles.headerSpacer} />
        {board !== null && !props.layout.compact ? (
          <Text style={styles.subtle}>Updated {relativeTime(board.fetchedAt)}</Text>
        ) : null}
        <Pressable
          style={styles.button}
          onPress={() => void refresh(undefined, true)}
          disabled={busy}
        >
          <Text style={styles.buttonLabel}>{busy ? "Loading…" : "Refresh"}</Text>
        </Pressable>
      </View>

      {filterOpen ? (
        <Pressable
          accessibilityLabel="Close repository filter"
          style={styles.backdrop}
          onPress={() => setFilterOpen(false)}
        />
      ) : null}

      {error !== null ? (
        <View style={styles.banner}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : null}

      {board === null ? (
        <View style={styles.centered}>
          {busy ? <ActivityIndicator color={props.theme.colors.accent} /> : null}
        </View>
      ) : props.layout.compact ? (
        <ScrollView horizontal contentContainerStyle={styles.columnsContent}>
          {columns.map((column) => (
            <Column key={column.id} column={column} styles={styles} />
          ))}
        </ScrollView>
      ) : (
        <View style={[styles.columns, styles.columnsContent]}>
          {columns.map((column) => (
            <Column key={column.id} column={column} styles={styles} />
          ))}
        </View>
      )}
    </View>
  );
}
