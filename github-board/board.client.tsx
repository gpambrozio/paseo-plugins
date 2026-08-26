import { type PluginSurfaceProps, useRpc, usePaseo } from "@getpaseo/plugin";
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
import type {
  Board,
  BoardColumn,
  BoardItem,
  ColumnId,
  Isolation,
  LaunchDefaults,
  LinkedIssue,
  ProjectRef,
  PromptSet,
  PromptSettings,
} from "./board.shared";
import {
  loadBoard,
  savePrompts,
  saveLogin,
  saveRepositoryFilter,
  sendOptions,
  sendToChat,
} from "./board.shared";

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

/**
 * Selects the freshly created workspace in the app, by its own route.
 *
 * This runs in the **client** bundle on purpose. The plugin's server half lives
 * next to the daemon, which on a remote host is a different machine from the one
 * the user is looking at — a link opened there would surface on the wrong
 * screen. `props.host.id` is the `serverId` the app's routes are keyed by
 * (`surface-screen.tsx` passes `{ id: serverId }`), so the client can address
 * the workspace on any host it is connected to.
 *
 * `?open=agent:<id>` is the app's own cold deep-link intent: the workspace
 * screen reads it, opens that agent's tab, and strips it from the URL. Without
 * it the workspace opens on whichever tab it feels like.
 *
 * Two mechanisms, because there is no plugin navigation API to use instead:
 *
 * - Native runs the app's own `paseo://` scheme through `Linking`, which expo
 *   router handles in-process.
 * - Web and the desktop renderer push the route onto `history` and announce it
 *   with a `popstate`, which is the event expo-router's linking listens on.
 *   `paseoDesktop.opener.openUrl` is *not* usable here: it only accepts http and
 *   https (`desktop/src/features/opener.ts`), so a `paseo://` link throws.
 *
 * The push is best effort, so the caller re-checks: `stillHere` reports whether
 * the surface is still mounted a beat later, and if it is, nothing routed and a
 * full location change finishes the job.
 */
function selectWorkspaceInApp(input: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  platform: PluginSurfaceProps["layout"]["platform"];
  stillHere: () => boolean;
}): void {
  // A `wks_…` id needs no encoding; encodeURIComponent covers the legacy
  // path-shaped ids too, which the app decodes back on the way in.
  const route = `/h/${encodeURIComponent(input.serverId)}/workspace/${encodeURIComponent(
    input.workspaceId,
  )}?open=${encodeURIComponent(`agent:${input.agentId}`)}`;

  if (input.platform !== "web") {
    void Linking.openURL(`paseo:/${route}`).catch((error: unknown) => {
      console.warn("[github-board] could not open the workspace deep link", error);
    });
    return;
  }

  // Typed structurally: this plugin compiles against Node's lib, not the DOM's,
  // and these globals only exist on the platforms this branch runs on anyway.
  const web = globalThis as {
    history?: { pushState?: (state: unknown, title: string, url: string) => void };
    location?: { assign?: (url: string) => void };
    dispatchEvent?: (event: unknown) => boolean;
    PopStateEvent?: new (type: string) => unknown;
    Event?: new (type: string) => unknown;
  };
  const PopState = web.PopStateEvent ?? web.Event;
  if (typeof web.history?.pushState !== "function" || PopState === undefined) return;
  try {
    web.history.pushState({}, "", route);
    web.dispatchEvent?.(new PopState("popstate"));
  } catch (error) {
    console.warn("[github-board] history navigation failed", error);
  }
  setTimeout(() => {
    // Still mounted means the router ignored the push — the surface would have
    // gone with the route otherwise. Loading the same URL outright is the
    // fallback, and it costs nothing when it never runs.
    if (!input.stillHere()) return;
    web.location?.assign?.(route);
  }, ROUTER_SETTLE_MS);
}

/** Long enough for expo-router to swap the screen, short enough not to feel stuck. */
const ROUTER_SETTLE_MS = 600;

/**
 * The four columns in display order, with the label the settings view gives
 * each one. Declared here rather than read off the board so the settings view
 * renders every type even before a board has loaded.
 */
const PROMPT_TYPES: readonly { id: ColumnId; label: string }[] = [
  { id: "issues", label: "Issues" },
  { id: "draft-prs", label: "Draft PRs" },
  { id: "open-prs", label: "Open PRs" },
  { id: "discussions", label: "Discussions" },
];

/** Every placeholder a template may use, shown to the user in the settings view. */
const PLACEHOLDERS = ["{url}", "{title}", "{number}", "{repository}"] as const;

/**
 * A project override wins over the type template, and a blank one does not
 * count — blank means inherit, which is what makes clearing a field the way to
 * drop an override. A card whose repository reaches no project has no override
 * to find, which is fine: it cannot be sent anywhere either.
 */
function templateFor(
  prompts: PromptSettings,
  type: ColumnId,
  projectId: string | null,
): string {
  const override = projectId === null ? undefined : prompts.byProject[projectId]?.[type];
  return override !== undefined && override.trim() !== "" ? override : prompts.byType[type];
}

/**
 * Substitutes the card's own fields. An unrecognised placeholder is left
 * standing rather than blanked, so a typo shows up in the paste instead of
 * silently swallowing part of the prompt.
 */
function renderTemplate(template: string, item: BoardItem): string {
  return template.replace(/\{(url|title|number|repository)\}/g, (_match, key: string) => {
    if (key === "url") return item.url;
    if (key === "title") return item.title;
    if (key === "number") return String(item.number);
    return item.repository;
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
let cachedPrompts: PromptSettings | null = null;

/**
 * Stands in until the first board lands. Blank templates are what the server
 * reads as "use the default", so the settings view opened before a load shows
 * empty fields rather than inventing values the server would disagree with.
 */
const EMPTY_PROMPTS: PromptSettings = {
  byType: { issues: "", "draft-prs": "", "open-prs": "", discussions: "" },
  byProject: {},
};

const NO_PROJECTS: readonly ProjectRef[] = [];

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
      /**
       * Centred over the surface rather than over the whole app: a plugin owns
       * its own view and nothing else. The layer clears the header's `zIndex`
       * of 30 and the repository filter's backdrop of 20.
       */
      modalLayer: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        padding: 20,
        zIndex: 40,
      },
      /**
       * The theme has no scrim token, and dimming with `foreground` would wash
       * light on a dark theme. Washing towards `surface0` instead reads as
       * de-emphasis in both, and leaves the card — same fill, but bordered —
       * as the only thing with an edge.
       */
      modalBackdrop: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: withAlpha(colors.surface0, "e6"),
      },
      modalCard: {
        width: "100%" as const,
        maxWidth: 420,
        gap: 12,
        backgroundColor: colors.surface0,
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 12,
        padding: 16,
      },
      modalTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
      modalTitleDanger: {
        color: colors.statusDanger,
        fontSize: 15,
        fontWeight: "600" as const,
      },
      modalBody: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      modalActions: { flexDirection: "row" as const, justifyContent: "flex-end" as const },
      centered: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },

      // --- New workspace dialog ---
      /**
       * Wider than the message modal because it holds a prompt the user is
       * expected to edit, not a sentence they are expected to read.
       */
      dialogCard: {
        width: "100%" as const,
        maxWidth: 560,
        gap: 12,
        backgroundColor: colors.surface0,
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 12,
        padding: 16,
      },
      dialogHeader: { gap: 2 },
      /**
       * A row of chips, and the anchor its popover hangs off. `zIndex` puts both
       * rows above the scrim that closes an open popover, so the chips stay
       * pressable and the popover stays on top of everything between them.
       */
      controlRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 6,
        zIndex: 2,
      },
      /**
       * The row whose popover is open, lifted over the other one. Without it the
       * two rows sit at the same level and paint order decides, which puts the
       * bottom row's chips on top of a menu the top row opened downward.
       */
      controlRowRaised: { zIndex: 3 },
      chipButtonDisabled: { opacity: 0.5 },
      promptInput: {
        color: colors.foreground,
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 13,
        lineHeight: 18,
        minHeight: 120,
        textAlignVertical: "top" as const,
      },
      /**
       * Covers the card between the two control rows while a popover is open, so
       * the press that dismisses it cannot land in the prompt underneath. Below
       * both rows in `zIndex`, so it never swallows a press on a chip.
       */
      cardScrim: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1,
      },
      /**
       * The floating menu itself. Bounded so it stays inside the card: Android
       * clips whatever leaves the parent's box, and a menu the user cannot see
       * the bottom of is worse than one that scrolls.
       */
      popover: {
        position: "absolute" as const,
        left: 0,
        minWidth: 280,
        maxWidth: 380,
        // Sized to fit above the bottom row without leaving the card, which
        // Android would clip.
        maxHeight: 240,
        backgroundColor: colors.surface0,
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 10,
        overflow: "hidden" as const,
      },
      popoverUp: { bottom: "100%" as const, marginBottom: 6 },
      popoverDown: { top: "100%" as const, marginTop: 6 },
      popoverHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: separator,
      },
      popoverBack: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: separator,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      popoverBackLabel: { color: colors.foreground, fontSize: 14, lineHeight: 16 },
      popoverHeaderLabel: {
        flexShrink: 1,
        color: colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      popoverSearch: {
        color: colors.foreground,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 13,
        borderBottomWidth: 1,
        borderBottomColor: separator,
      },
      popoverScroll: { flexShrink: 1 },
      popoverList: { paddingVertical: 4 },
      popoverSection: {
        color: colors.foregroundMuted,
        fontSize: 11,
        paddingHorizontal: 10,
        paddingTop: 6,
        paddingBottom: 2,
      },
      popoverRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
      },
      popoverRowSelected: { backgroundColor: withAlpha(colors.accent, "22") },
      popoverRowPressed: { backgroundColor: withAlpha(colors.foregroundMuted, "1a") },
      /**
       * Label and detail on one line, the way Paseo's own model rows read
       * ("Opus 5 — Opus 5 · Latest release"). `minWidth: 0` is what lets the
       * detail truncate instead of shoving the tick out of the row.
       */
      popoverRowText: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row" as const,
        alignItems: "baseline" as const,
        gap: 6,
      },
      popoverTrailing: { color: colors.foregroundMuted, fontSize: 11 },
      popoverTick: { color: colors.accent, fontSize: 12, fontWeight: "700" as const },
      popoverEmpty: { color: colors.foregroundMuted, fontSize: 12, padding: 12 },
      optionLabel: { color: colors.foreground, fontSize: 13, flexShrink: 0 },
      optionDescription: {
        flexShrink: 1,
        color: colors.foregroundMuted,
        fontSize: 11,
        lineHeight: 15,
      },
      dialogActionsSpacer: { flex: 1 },

      // --- Configure prompts view ---
      settingsBody: { padding: layout.compact ? 12 : 20, gap: 20, paddingBottom: 40 },
      section: { gap: 8 },
      sectionTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
      sectionHint: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      /** Wraps rather than scrolls: every scope stays reachable without a gesture. */
      scopeRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      scopeChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
      scopeLabelSelected: { color: colors.accentForeground, fontSize: 12 },
      fieldLabel: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
      /**
       * `textAlignVertical` is the Android spelling for top-aligning multiline
       * text; the other platforms already do it.
       */
      templateInput: {
        color: colors.foreground,
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 13,
        lineHeight: 18,
        minHeight: 64,
        textAlignVertical: "top" as const,
      },
      inheritedNote: { color: colors.foregroundMuted, fontSize: 11, fontStyle: "italic" as const },
      buttonDisabled: { opacity: 0.5 },
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
      // Bottom-right and out of flow, so revealing it on hover never reflows the
      // card and never nudges the cards below it. It sits over the footer's
      // trailing labels, so it is opaque rather than tinted.
      sendButton: {
        position: "absolute" as const,
        right: 8,
        bottom: 8,
        backgroundColor: colors.accent,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
      },
      // Hidden, never disabled. It keeps taking pointer events so it can report
      // its own hover, and a pointer cannot reach it without first crossing the
      // card and revealing it — so there is no invisible click target.
      sendButtonHidden: { opacity: 0 },
      sendButtonPressed: { opacity: 0.75 },
      sendButtonLabel: {
        color: colors.accentForeground,
        fontSize: 11,
        fontWeight: "600" as const,
      },
      cardRepo: { color: colors.foregroundMuted, fontSize: 11 },
      // Muted like the rest of the footer but weighted, so "someone else's"
      // reads at a glance without competing with the title above it.
      cardAuthor: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
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
      // Accent-tinted so a folded-in issue reads as a link to other work rather
      // than as one more label on the pull request.
      linkedIssue: {
        color: colors.accent,
        fontSize: 10,
        fontWeight: "600" as const,
        overflow: "hidden" as const,
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderWidth: 1,
        borderColor: withAlpha(colors.accent, "66"),
        backgroundColor: withAlpha(colors.accent, "1a"),
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

/**
 * The repository is spelled out only when the issue lives somewhere other than
 * the pull request; within one repository the number alone is how GitHub itself
 * reads.
 */
function linkedIssueLabel(issue: LinkedIssue, repository: string): string {
  return issue.repository === repository || issue.repository === ""
    ? `Issue #${issue.number}`
    : `Issue ${issue.repository}#${issue.number}`;
}

function Card({
  item,
  viewerLogin,
  styles,
  hoverToReveal,
  onSend,
  type,
}: {
  item: BoardItem;
  /** The login the board was queried for, so a card of someone else's reads as one. */
  viewerLogin: string;
  styles: Styles;
  /** False on touch platforms, where nothing ever hovers and the action would hide forever. */
  hoverToReveal: boolean;
  onSend: (item: BoardItem, type: ColumnId) => void;
  /** Chooses the prompt template; the card is otherwise column-agnostic. */
  type: ColumnId;
}) {
  /**
   * Two hover states, not one. The action sits inside the card, and moving onto
   * it takes the pointer off the card as far as the card's own hover is
   * concerned — so tracking only the card would hide the action the moment the
   * user reached for it. Either one being hovered keeps it revealed.
   */
  const [cardHovered, setCardHovered] = useState(false);
  const [actionHovered, setActionHovered] = useState(false);

  /**
   * Revealed by style rather than by mounting: an action that unmounts under the
   * cursor can never report the hover that would have kept it alive.
   */
  const revealed = !hoverToReveal || cardHovered || actionHovered;

  const open = useCallback(() => {
    openExternalUrl(item.url);
  }, [item.url]);

  // No in-flight state: the press opens the launch dialog, which owns every
  // wait from there on.
  const send = useCallback(() => {
    onSend(item, type);
  }, [item, onSend, type]);

  const closes = item.linkedIssues
    .map((issue) => linkedIssueLabel(issue, item.repository))
    .join(", ");

  /**
   * Named only when it is not the viewer's own work. Most of the board still is
   * the viewer's, so a byline on every card would be noise hiding the one thing
   * it is there to say: someone else opened this.
   */
  const byline = item.author !== null && item.author !== viewerLogin ? item.author : null;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${item.repository} #${item.number}: ${item.title}${
        byline === null ? "" : `, opened by ${byline}`
      }${closes === "" ? "" : `, closes ${closes}`}`}
      onPress={open}
      onHoverIn={() => setCardHovered(true)}
      onHoverOut={() => setCardHovered(false)}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      <Text style={styles.cardRepo} numberOfLines={1}>
        {item.repository} #{item.number}
      </Text>
      <Text style={styles.cardTitle} numberOfLines={3}>
        {item.title}
      </Text>
      <View style={styles.cardFooter}>
        {byline !== null ? <Text style={styles.cardAuthor}>by {byline}</Text> : null}
        <Text style={styles.subtle}>{relativeTime(item.updatedAt)}</Text>
        {item.commentsCount > 0 ? (
          <Text style={styles.subtle}>{item.commentsCount} comments</Text>
        ) : null}
        {item.linkedIssues.map((issue) => (
          <Text key={issue.id} style={styles.linkedIssue}>
            {linkedIssueLabel(issue, item.repository)}
          </Text>
        ))}
        {item.detail !== null ? <Text style={styles.label}>{item.detail}</Text> : null}
        {item.labels.slice(0, 3).map((label) => (
          <Text key={label} style={styles.label}>
            {label}
          </Text>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Send ${item.repository} #${item.number} to a new workspace chat`}
        onPress={send}
        onHoverIn={() => setActionHovered(true)}
        onHoverOut={() => setActionHovered(false)}
        style={({ pressed }) => [
          styles.sendButton,
          revealed ? null : styles.sendButtonHidden,
          pressed ? styles.sendButtonPressed : null,
        ]}
      >
        <Text style={styles.sendButtonLabel}>Send to chat</Text>
      </Pressable>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// The launch dialog
// ---------------------------------------------------------------------------

/**
 * One entry of the host's provider snapshot — every provider it knows about,
 * with the models and permission modes each one offers. Derived from the API
 * rather than imported from `@getpaseo/protocol`, because a plugin client bundle
 * may only import react, react-native, react-query, zod and `@getpaseo/plugin`.
 */
type ProviderEntry = Awaited<
  ReturnType<ReturnType<typeof usePaseo>["providers"]["snapshot"]>
>["entries"][number];

interface Choice {
  id: string;
  label: string;
  description: string | null;
}

interface ModelChoice extends Choice {
  isDefault: boolean;
  /** Empty for a model with no thinking levels, which hides that control. */
  thinkingOptions: readonly Choice[];
  defaultThinkingOptionId: string | null;
}

interface ProviderChoice extends Choice {
  models: readonly ModelChoice[];
  /** Empty for a provider with no permission modes, which hides that control. */
  modes: readonly Choice[];
  defaultModeId: string | null;
}

/** What one agent is launched with, once every field has been checked against the host. */
interface Configuration {
  provider: string;
  model: string;
  modeId: string | null;
  thinkingOptionId: string | null;
}

/** A configuration as it was *asked for*: any field may be missing or stale. */
type DesiredConfiguration = Omit<LaunchDefaults, "isolation">;

function toChoice(option: {
  id: string;
  label: string;
  description?: string | undefined;
}): Choice {
  return { id: option.id, label: option.label, description: option.description ?? null };
}

/**
 * The providers this dialog can actually launch, in the host's own order.
 *
 * A provider with no selectable model is dropped rather than shown with a
 * "Default" row: the SDK creates agents by `provider/model` and rejects a bare
 * provider, so a row that cannot name a model is a row that cannot be sent.
 * Providers that are disabled, or still discovering, simply have nothing to
 * offer yet — a snapshot update brings them in when they do.
 */
function readProviders(entries: readonly ProviderEntry[]): ProviderChoice[] {
  const providers: ProviderChoice[] = [];
  for (const entry of entries) {
    if (entry.enabled === false) continue;
    const models = (entry.models ?? [])
      .filter((model) => model.isSelectable !== false)
      .map((model) => ({
        ...toChoice(model),
        isDefault: model.isDefault === true,
        thinkingOptions: (model.thinkingOptions ?? []).map(toChoice),
        defaultThinkingOptionId: model.defaultThinkingOptionId ?? null,
      }));
    if (models.length === 0) continue;
    providers.push({
      id: entry.provider,
      label: entry.label ?? entry.provider,
      description: entry.description ?? null,
      models,
      modes: (entry.modes ?? []).map(toChoice),
      defaultModeId: entry.defaultModeId ?? null,
    });
  }
  return providers;
}

/**
 * Settles a wish into something launchable: what was asked for where the host
 * still offers it, and the host's own default where it does not. That is what
 * lets a saved preference survive a model being renamed or a provider being
 * uninstalled, instead of failing the send.
 */
function resolveConfiguration(
  providers: readonly ProviderChoice[],
  desired: DesiredConfiguration,
): Configuration | null {
  const provider = providers.find((entry) => entry.id === desired.provider) ?? providers[0];
  if (provider === undefined) return null;
  const model =
    provider.models.find((entry) => entry.id === desired.model) ??
    provider.models.find((entry) => entry.isDefault) ??
    provider.models[0];
  if (model === undefined) return null;
  const thinking =
    model.thinkingOptions.find((option) => option.id === desired.thinkingOptionId) ??
    model.thinkingOptions.find((option) => option.id === model.defaultThinkingOptionId) ??
    model.thinkingOptions[0];
  const mode =
    provider.modes.find((option) => option.id === desired.modeId) ??
    provider.modes.find((option) => option.id === provider.defaultModeId) ??
    provider.modes[0];
  return {
    provider: provider.id,
    model: model.id,
    thinkingOptionId: thinking?.id ?? null,
    modeId: mode?.id ?? null,
  };
}

/** Which control's popover is open; only ever one at a time. */
type PickerId = "isolation" | "model" | "thinking" | "mode";

const ISOLATION_CHOICES: readonly Choice[] = [
  { id: "local", label: "Local", description: "Work in the project's own checkout." },
  {
    id: "worktree",
    label: "New worktree",
    description: "Cut a fresh git worktree on its own branch.",
  },
];

/**
 * Ranks one row against a search query the way Paseo's model browser does —
 * over the model's label, its id, its provider's label and its description —
 * without `@getpaseo/protocol/search/text-match`, which a plugin client bundle
 * cannot import. An earlier match wins over a later one, and an earlier field
 * over a later one, which is what puts a name match above a description match.
 */
function scoreFields(fields: readonly string[], query: string): number | null {
  let best: number | null = null;
  for (const [position, field] of fields.entries()) {
    const index = field.toLowerCase().indexOf(query);
    if (index < 0) continue;
    const score = index * 10 + position;
    if (best === null || score < best) best = score;
  }
  return best;
}

/** One model as the picker lists it, carrying the provider it came from. */
interface ModelRow {
  /** `provider/model`, the id the dialog selects by. */
  id: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
  description: string | null;
}

function modelRowsFor(provider: ProviderChoice): ModelRow[] {
  return provider.models.map((model) => ({
    id: `${provider.id}/${model.id}`,
    providerId: provider.id,
    providerLabel: provider.label,
    modelId: model.id,
    label: model.label,
    description: model.description,
  }));
}

function rankModelRows(rows: readonly ModelRow[], query: string): ModelRow[] {
  if (query === "") return [...rows];
  return rows
    .map((row) => ({
      row,
      score: scoreFields([row.label, row.modelId, row.providerLabel, row.description ?? ""], query),
    }))
    .filter((entry): entry is { row: ModelRow; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.row.label.localeCompare(right.row.label))
    .map((entry) => entry.row);
}

/**
 * A chip on one of the dialog's control rows. Shaped like the repository
 * filter's chips so the two read as the same control, and it shows its current
 * value rather than its name — the value is what a user checks before sending.
 */
function ControlChip({
  styles,
  label,
  disabled,
  onPress,
}: {
  styles: Styles;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled === true}
      onPress={onPress}
      style={[styles.chipButton, disabled === true ? styles.chipButtonDisabled : null]}
    >
      <Text style={styles.chipLabel}>{label} ▾</Text>
    </Pressable>
  );
}

/**
 * The floating panel a control opens, anchored to its **row** rather than to
 * the chip itself. Anchoring to the chip would need the chip's offset inside
 * the card, and a popover that opens past the card's right edge is clipped
 * outright on Android; the row's left edge is always inside the card, and one
 * consistent position reads as a menu rather than as a misplaced chip.
 *
 * `direction` keeps it inside the card too: the top row opens down over the
 * prompt, the bottom row opens up over it.
 */
function Popover({
  styles,
  direction,
  children,
}: {
  styles: Styles;
  direction: "up" | "down";
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.popover, direction === "up" ? styles.popoverUp : styles.popoverDown]}>
      {children}
    </View>
  );
}

/** One selectable line: label, optional detail, and a tick when it is the current value. */
function PopoverRow({
  styles,
  label,
  description,
  selected,
  trailing,
  onPress,
}: {
  styles: Styles;
  label: string;
  description: string | null;
  selected: boolean;
  /** Right-hand text, e.g. a provider's model count. */
  trailing?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.popoverRow,
        selected ? styles.popoverRowSelected : null,
        pressed ? styles.popoverRowPressed : null,
      ]}
    >
      <View style={styles.popoverRowText}>
        <Text style={styles.optionLabel} numberOfLines={1}>
          {label}
        </Text>
        {description === null ? null : (
          <Text style={styles.optionDescription} numberOfLines={1}>
            {description}
          </Text>
        )}
      </View>
      {trailing === undefined ? null : <Text style={styles.popoverTrailing}>{trailing}</Text>}
      {selected ? <Text style={styles.popoverTick}>✓</Text> : null}
    </Pressable>
  );
}

/** The isolation, thinking and permission-mode popovers: one flat list, no search. */
function ChoicePopover({
  styles,
  direction,
  options,
  selectedId,
  onSelect,
}: {
  styles: Styles;
  direction: "up" | "down";
  options: readonly Choice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Popover styles={styles} direction={direction}>
      <ScrollView style={styles.popoverScroll} contentContainerStyle={styles.popoverList}>
        {options.map((option) => (
          <PopoverRow
            key={option.id}
            styles={styles}
            label={option.label}
            description={option.description}
            selected={option.id === selectedId}
            onPress={() => onSelect(option.id)}
          />
        ))}
      </ScrollView>
    </Popover>
  );
}

type ModelView = { kind: "all" } | { kind: "provider"; id: string };

/**
 * The model picker, in the two steps Paseo's own model browser uses: the
 * providers, then one provider's models behind a back arrow. A flat list of
 * every model on the host is unreadable once a provider ships fourteen of them.
 *
 * Where it opens follows `resolveInitialModelBrowserView`: a lone provider skips
 * the redundant provider step, and an already-chosen provider opens on its own
 * models. Searching from the provider step ranks across *all* providers, which
 * is why its placeholder says so.
 */
function ModelPopover({
  styles,
  providers,
  selectedId,
  onSelect,
}: {
  styles: Styles;
  providers: readonly ProviderChoice[];
  /** `provider/model`, or null before the first snapshot lands. */
  selectedId: string | null;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [view, setView] = useState<ModelView>(() => {
    const only = providers.length === 1 ? providers[0] : undefined;
    if (only !== undefined) return { kind: "provider", id: only.id };
    const selectedProvider = selectedId?.slice(0, selectedId.indexOf("/"));
    return selectedProvider !== undefined &&
      providers.some((provider) => provider.id === selectedProvider)
      ? { kind: "provider", id: selectedProvider }
      : { kind: "all" };
  });
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();

  const provider =
    view.kind === "provider" ? providers.find((entry) => entry.id === view.id) : undefined;

  const rows = useMemo(() => {
    if (provider !== undefined) return rankModelRows(modelRowsFor(provider), normalized);
    if (normalized === "") return [];
    return rankModelRows(
      providers.flatMap((entry) => modelRowsFor(entry)),
      normalized,
    );
  }, [normalized, provider, providers]);

  // Cross-provider results name the provider up front, because the same model
  // label ships on more than one of them.
  const describe = (row: ModelRow): string | null =>
    provider !== undefined
      ? row.description
      : row.description === null
        ? row.providerLabel
        : `${row.providerLabel} · ${row.description}`;

  const browsing = provider === undefined && normalized === "";

  return (
    <Popover styles={styles} direction="up">
      {provider === undefined ? null : (
        <View style={styles.popoverHeader}>
          {providers.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to providers"
              onPress={() => setView({ kind: "all" })}
              style={styles.popoverBack}
            >
              <Text style={styles.popoverBackLabel}>‹</Text>
            </Pressable>
          ) : null}
          <Text style={styles.popoverHeaderLabel} numberOfLines={1}>
            {provider.label}
          </Text>
        </View>
      )}
      <TextInput
        accessibilityLabel="Search models"
        style={styles.popoverSearch}
        value={query}
        onChangeText={setQuery}
        placeholder={provider === undefined ? "Search all models…" : "Search models…"}
        placeholderTextColor={styles.subtle.color}
        autoCorrect={false}
      />
      <ScrollView style={styles.popoverScroll} contentContainerStyle={styles.popoverList}>
        {browsing ? (
          <>
            <Text style={styles.popoverSection}>Providers</Text>
            {providers.map((entry) => (
              <PopoverRow
                key={entry.id}
                styles={styles}
                label={entry.label}
                description={null}
                selected={false}
                trailing={`${entry.models.length} ${
                  entry.models.length === 1 ? "model" : "models"
                } ›`}
                onPress={() => setView({ kind: "provider", id: entry.id })}
              />
            ))}
          </>
        ) : rows.length === 0 ? (
          <Text style={styles.popoverEmpty}>
            {normalized === ""
              ? "This provider offers no models."
              : `No models match “${query.trim()}”`}
          </Text>
        ) : (
          rows.map((row) => (
            <PopoverRow
              key={row.id}
              styles={styles}
              label={row.label}
              description={describe(row)}
              selected={row.id === selectedId}
              onPress={() => onSelect(row.providerId, row.modelId)}
            />
          ))
        )}
      </ScrollView>
    </Popover>
  );
}

interface SendProject {
  id: string;
  name: string;
  rootPath: string;
  supportsWorktree: boolean;
}

interface LaunchResult {
  workspaceId: string;
  workspaceName: string;
  projectName: string;
  agentId: string;
}

/**
 * What Paseo's own New workspace screen asks before it starts a chat, for one
 * card: where the workspace is cut, which agent runs it, how hard it thinks,
 * which permission mode it runs under, and the first message.
 *
 * The host is not a choice here. A plugin surface is bound to the daemon that
 * contributed it — `usePaseo()` is that daemon's client and nothing reaches
 * another one — and the board itself is that host's `gh`. Switching hosts is the
 * surface header's job, so the dialog names the host rather than offering it.
 */
function SendDialog({
  item,
  initialPrompt,
  hostLabel,
  styles,
  accentColor,
  onCancel,
  onLaunched,
}: {
  item: BoardItem;
  /** The card's prompt template, already rendered. The user may rewrite it. */
  initialPrompt: string;
  hostLabel: string;
  styles: Styles;
  accentColor: string;
  onCancel: () => void;
  onLaunched: (result: LaunchResult) => void;
}) {
  const paseo = usePaseo();
  const loadOptions = useRpc(sendOptions);
  const launch = useRpc(sendToChat);

  const [prompt, setPrompt] = useState(initialPrompt);
  const [project, setProject] = useState<SendProject | null>(null);
  const [defaults, setDefaults] = useState<LaunchDefaults | null>(null);
  const [entries, setEntries] = useState<readonly ProviderEntry[] | null>(null);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [isolation, setIsolation] = useState<Isolation>("local");
  const [picker, setPicker] = useState<PickerId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const closePicker = useCallback(() => setPicker(null), []);

  // Which project this card belongs to, and what the last send was set to.
  useEffect(() => {
    let cancelled = false;
    loadOptions({ repository: item.repository, url: item.url })
      .then((result) => {
        if (cancelled) return;
        setProject(result.project);
        setDefaults(result.defaults);
        setIsolation(result.defaults.isolation);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [item.repository, item.url, loadOptions]);

  /**
   * The snapshot is taken against the project's checkout rather than the
   * daemon's cwd, because a provider can offer different models per directory —
   * the same reason Paseo's own composer passes one.
   */
  const cwd = project?.rootPath ?? null;
  useEffect(() => {
    if (cwd === null) return undefined;
    let cancelled = false;
    paseo.providers
      .snapshot({ cwd })
      .then((snapshot) => {
        if (!cancelled) setEntries(snapshot.entries);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    // Discovery is lazy on the daemon, so a provider still loading when the
    // snapshot was taken arrives later as an update rather than as a second
    // reply. An update for another directory is not ours to adopt.
    const unsubscribe = paseo.providers.subscribe((update) => {
      if (cancelled) return;
      if (update.cwd !== undefined && update.cwd !== cwd) return;
      setEntries(update.entries);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cwd, paseo]);

  const providers = useMemo(() => (entries === null ? null : readProviders(entries)), [entries]);

  // Re-settled whenever the host's offering changes, keeping whatever the user
  // has already picked wherever it is still on offer.
  useEffect(() => {
    if (providers === null || defaults === null) return;
    setConfiguration((current) => resolveConfiguration(providers, current ?? defaults));
  }, [defaults, providers]);

  const provider = useMemo(
    () => providers?.find((entry) => entry.id === configuration?.provider) ?? null,
    [configuration?.provider, providers],
  );
  const model = useMemo(
    () => provider?.models.find((entry) => entry.id === configuration?.model) ?? null,
    [configuration?.model, provider],
  );

  const selectedModelId =
    configuration === null ? null : `${configuration.provider}/${configuration.model}`;

  const selectModel = useCallback(
    (nextProvider: string, nextModel: string) => {
      setConfiguration((current) =>
        providers === null
          ? current
          : resolveConfiguration(providers, {
              provider: nextProvider,
              model: nextModel,
              modeId: current?.modeId ?? null,
              // Dropped on purpose: thinking levels belong to the model, so a
              // new model takes its own default rather than the old one's.
              thinkingOptionId: null,
            }),
      );
      setPicker(null);
    },
    [providers],
  );

  const send = useCallback(() => {
    if (configuration === null || busy) return;
    const text = prompt.trim();
    if (text === "") return;
    setBusy(true);
    setError(null);
    setPicker(null);
    launch({
      repository: item.repository,
      number: item.number,
      title: item.title,
      url: item.url,
      prompt: text,
      isolation,
      provider: configuration.provider,
      model: configuration.model,
      modeId: configuration.modeId,
      thinkingOptionId: configuration.thinkingOptionId,
    })
      .then(onLaunched)
      .catch((cause: unknown) => {
        // Left open on failure, with everything still typed in: the workspace
        // may or may not exist, but the user's prompt certainly should not be
        // thrown away.
        setBusy(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [busy, configuration, isolation, item, launch, onLaunched, prompt]);

  const ready = configuration !== null && project !== null && prompt.trim() !== "";
  const thinkingOptions = model?.thinkingOptions ?? [];
  const modes = provider?.modes ?? [];

  return (
    <View style={styles.modalLayer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={picker === null ? "Cancel" : "Close menu"}
        style={styles.modalBackdrop}
        // An open popover swallows the first press outside itself, the way every
        // menu does; a send in flight is not cancellable at all.
        onPress={picker !== null ? closePicker : busy ? () => {} : onCancel}
      />
      <View accessibilityViewIsModal style={styles.dialogCard}>
        <View style={styles.dialogHeader}>
          <Text style={styles.modalTitle}>New workspace</Text>
          <Text style={styles.subtle} numberOfLines={1}>
            {hostLabel}
            {project === null ? "" : ` · ${project.name}`}
          </Text>
        </View>
        <Text style={styles.modalBody} numberOfLines={2}>
          {item.repository} #{item.number} — {item.title}
        </Text>

        {/* Its own row, out-stacking the scrim so its popover stays clickable. */}
        <View
          style={[styles.controlRow, picker === "isolation" ? styles.controlRowRaised : null]}
        >
          <ControlChip
            styles={styles}
            label={isolation === "worktree" ? "New worktree" : "Local"}
            // A non-git project has no worktree to cut, so the control says
            // Local and stops there rather than offering a choice that fails.
            disabled={project === null || !project.supportsWorktree}
            onPress={() => setPicker(picker === "isolation" ? null : "isolation")}
          />
          {picker === "isolation" ? (
            <ChoicePopover
              styles={styles}
              direction="down"
              options={ISOLATION_CHOICES}
              selectedId={isolation}
              onSelect={(id) => {
                setIsolation(id === "worktree" ? "worktree" : "local");
                setPicker(null);
              }}
            />
          ) : null}
        </View>

        <TextInput
          accessibilityLabel="First message"
          style={styles.promptInput}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          editable={!busy}
          placeholder="What should the agent do?"
          placeholderTextColor={styles.subtle.color}
        />

        {error === null ? null : <Text style={styles.danger}>{error}</Text>}

        {/* Catches the press that closes an open popover, everywhere the popover
            and the control rows are not. It sits above the header and the prompt
            and below both rows, so a press there closes the menu instead of
            landing in the field underneath it. */}
        {picker === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            style={styles.cardScrim}
            onPress={closePicker}
          />
        )}

        <View
          style={[styles.controlRow, picker === "isolation" ? null : styles.controlRowRaised]}
        >
          <ControlChip
            styles={styles}
            label={
              model !== null
                ? model.label
                : providers === null
                  ? "Loading agents…"
                  : "Select model"
            }
            disabled={providers === null || providers.length === 0}
            onPress={() => setPicker(picker === "model" ? null : "model")}
          />
          {thinkingOptions.length > 0 ? (
            <ControlChip
              styles={styles}
              label={
                thinkingOptions.find((option) => option.id === configuration?.thinkingOptionId)
                  ?.label ?? "Thinking"
              }
              onPress={() => setPicker(picker === "thinking" ? null : "thinking")}
            />
          ) : null}
          {modes.length > 0 ? (
            <ControlChip
              styles={styles}
              label={
                modes.find((option) => option.id === configuration?.modeId)?.label ??
                "Permission mode"
              }
              onPress={() => setPicker(picker === "mode" ? null : "mode")}
            />
          ) : null}

          {busy ? <ActivityIndicator color={accentColor} /> : null}
          <View style={styles.dialogActionsSpacer} />
          <Pressable
            accessibilityRole="button"
            style={styles.ghostButton}
            onPress={onCancel}
            disabled={busy}
          >
            <Text style={styles.ghostButtonLabel}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.button, ready && !busy ? null : styles.buttonDisabled]}
            onPress={send}
            disabled={!ready || busy}
          >
            <Text style={styles.buttonLabel}>{busy ? "Starting…" : "Send"}</Text>
          </Pressable>

          {picker === "model" && providers !== null ? (
            <ModelPopover
              styles={styles}
              providers={providers}
              selectedId={selectedModelId}
              onSelect={selectModel}
            />
          ) : null}
          {picker === "thinking" ? (
            <ChoicePopover
              styles={styles}
              direction="up"
              options={thinkingOptions}
              selectedId={configuration?.thinkingOptionId ?? null}
              onSelect={(id) => {
                setConfiguration((current) =>
                  current === null ? current : { ...current, thinkingOptionId: id },
                );
                setPicker(null);
              }}
            />
          ) : null}
          {picker === "mode" ? (
            <ChoicePopover
              styles={styles}
              direction="up"
              options={modes}
              selectedId={configuration?.modeId ?? null}
              onSelect={(id) => {
                setConfiguration((current) => (current === null ? current : { ...current, modeId: id }));
                setPicker(null);
              }}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * The "Configure prompts" view. It edits a local draft and persists on Save, so
 * leaving without saving discards — the alternative, writing on every
 * keystroke, would save half-typed templates and cost a round trip per
 * character.
 *
 * The scope selector decides *what* the four fields edit: the type defaults, or
 * one project's overrides. One set of fields serves both, because a project
 * override is the same four templates with "inherit" as an option.
 */
function PromptSettingsView({
  styles,
  prompts,
  projects,
  login,
  busy,
  mutedColor,
  onSave,
  onApplyLogin,
}: {
  styles: Styles;
  prompts: PromptSettings;
  projects: readonly ProjectRef[];
  login: string;
  busy: boolean;
  mutedColor: string;
  onSave: (next: PromptSettings) => Promise<void>;
  onApplyLogin: (login: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PromptSettings>(prompts);
  const [scope, setScope] = useState<string | null>(null);
  const [loginDraft, setLoginDraft] = useState(login);
  const [saving, setSaving] = useState(false);

  // The saved value is the baseline for "dirty". Adopting it whenever the
  // server hands back a new one is what turns a successful save back into a
  // clean state without a second signal.
  const savedRef = useRef(prompts);
  useEffect(() => {
    if (savedRef.current === prompts) return;
    savedRef.current = prompts;
    setDraft(prompts);
  }, [prompts]);

  // Same adopt-on-change rule for the login: the prop only moves when a board
  // load confirms a new one, so this never fights what is being typed.
  const loginRef = useRef(login);
  useEffect(() => {
    if (loginRef.current === login) return;
    loginRef.current = login;
    setLoginDraft(login);
  }, [login]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(prompts);

  const setTemplate = useCallback(
    (type: ColumnId, value: string) => {
      setDraft((current) => {
        if (scope === null) {
          return { ...current, byType: { ...current.byType, [type]: value } };
        }
        // Rebuilt key by key rather than spread: `exactOptionalPropertyTypes`
        // rejects the `string | undefined` a spread of a Partial produces.
        const existing = current.byProject[scope];
        const overrides: Partial<PromptSet> = {};
        for (const candidate of PROMPT_TYPES) {
          const template = existing?.[candidate.id];
          if (template !== undefined) overrides[candidate.id] = template;
        }
        if (value.trim() === "") delete overrides[type];
        else overrides[type] = value;
        const byProject = { ...current.byProject };
        if (Object.keys(overrides).length === 0) delete byProject[scope];
        else byProject[scope] = overrides;
        return { ...current, byProject };
      });
    },
    [scope],
  );

  const save = useCallback(() => {
    if (saving) return;
    setSaving(true);
    void onSave(draft).finally(() => setSaving(false));
  }, [draft, onSave, saving]);

  return (
    <ScrollView contentContainerStyle={styles.settingsBody}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>GitHub account</Text>
        <Text style={styles.sectionHint}>
          The login every column is queried for. Leave it empty to use whichever account `gh` is
          authenticated as on the daemon machine.
        </Text>
        <View style={styles.row}>
          <TextInput
            style={styles.loginInput}
            value={loginDraft}
            onChangeText={setLoginDraft}
            onSubmitEditing={() => void onApplyLogin(loginDraft)}
            placeholder="github login"
            placeholderTextColor={mutedColor}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
          <Pressable
            accessibilityRole="button"
            style={styles.ghostButton}
            disabled={busy}
            onPress={() => void onApplyLogin(loginDraft)}
          >
            <Text style={styles.ghostButtonLabel}>{busy ? "Loading…" : "Apply"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Prompts</Text>
        <Text style={styles.sectionHint}>
          What "Send to chat" copies to your clipboard. Available placeholders:{" "}
          {PLACEHOLDERS.join(", ")}. Pick a project to override its prompts; a card is matched to a
          project by the repository's git remote, the same way sending one is.
        </Text>

        <View style={styles.scopeRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: scope === null }}
            style={[styles.chipButton, scope === null ? styles.scopeChipSelected : null]}
            onPress={() => setScope(null)}
          >
            <Text style={scope === null ? styles.scopeLabelSelected : styles.chipLabel}>
              All projects
            </Text>
          </Pressable>
          {projects.map((project) => {
            const selected = scope === project.id;
            const overridden = Object.keys(draft.byProject[project.id] ?? {}).length > 0;
            return (
              <Pressable
                key={project.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.chipButton, selected ? styles.scopeChipSelected : null]}
                onPress={() => setScope(project.id)}
              >
                <Text style={selected ? styles.scopeLabelSelected : styles.chipLabel}>
                  {project.name}
                  {overridden ? " •" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {PROMPT_TYPES.map(({ id, label }) => {
          const inherited = draft.byType[id];
          const override = scope === null ? undefined : draft.byProject[scope]?.[id];
          const value = scope === null ? inherited : (override ?? "");
          return (
            <View key={id} style={styles.section}>
              <Text style={styles.fieldLabel}>{label}</Text>
              <TextInput
                style={styles.templateInput}
                value={value}
                onChangeText={(next) => setTemplate(id, next)}
                multiline
                placeholder={scope === null ? "Uses the built-in default when empty" : inherited}
                placeholderTextColor={mutedColor}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {scope !== null && override === undefined ? (
                <Text style={styles.inheritedNote}>Inherited from all projects.</Text>
              ) : null}
            </View>
          );
        })}

        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !dirty || saving }}
            style={[styles.button, !dirty || saving ? styles.buttonDisabled : null]}
            disabled={!dirty || saving}
            onPress={save}
          >
            <Text style={styles.buttonLabel}>
              {saving ? "Saving…" : dirty ? "Save prompts" : "Saved"}
            </Text>
          </Pressable>
          {dirty ? (
            <Pressable
              accessibilityRole="button"
              style={styles.ghostButton}
              onPress={() => setDraft(prompts)}
            >
              <Text style={styles.ghostButtonLabel}>Revert</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

function Column({
  column,
  viewerLogin,
  styles,
  hoverToReveal,
  onSend,
}: {
  column: BoardColumn;
  viewerLogin: string;
  styles: Styles;
  hoverToReveal: boolean;
  onSend: (item: BoardItem, type: ColumnId) => void;
}) {
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
          column.items.map((item) => (
            <Card
              key={item.id}
              item={item}
              viewerLogin={viewerLogin}
              styles={styles}
              hoverToReveal={hoverToReveal}
              onSend={onSend}
              type={column.id}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

export function GitHubBoard(props: PluginSurfaceProps) {
  const styles = useStyles(props);
  /** Only a pointer platform can hover; on iOS and Android the action stays visible. */
  const hoverToReveal = props.layout.platform === "web";
  const load = useRpc(loadBoard);
  const persistLogin = useRpc(saveLogin);
  const persistFilter = useRpc(saveRepositoryFilter);
  const persistPrompts = useRpc(savePrompts);

  const [board, setBoard] = useState<Board | null>(cachedBoard);
  const [error, setError] = useState<string | null>(null);
  /**
   * The outcome of the last "Send to chat", success or failure. It is deliberately
   * not `error`: a card that could not be matched to a project says nothing about
   * whether the board itself loaded.
   */
  const [notice, setNotice] = useState<{
    tone: "info" | "danger";
    title: string;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(cachedBoard === null);
  const [loginDraft, setLoginDraft] = useState(cachedBoard?.login ?? "");
  const [hiddenRepos, setHiddenRepos] = useState<ReadonlySet<string>>(
    () => cachedHidden ?? new Set(),
  );
  const [filterOpen, setFilterOpen] = useState(false);
  /** The surface shows one of two things; plugins cannot route between surfaces. */
  const [showSettings, setShowSettings] = useState(false);
  const [prompts, setPrompts] = useState<PromptSettings | null>(cachedPrompts);
  /** The card the launch dialog is open on, with its prompt already rendered. */
  const [sendTarget, setSendTarget] = useState<{ item: BoardItem; prompt: string } | null>(null);
  /**
   * Whether this surface is still on screen, read after a navigation attempt:
   * routing away unmounts it, so still being here means nothing routed.
   */
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
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
        // Unlike the filter, prompts are adopted on every load: nothing edits
        // them outside the settings view, and that view owns its own draft.
        cachedPrompts = next.prompts;
        setPrompts(next.prompts);
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
    const visible =
      hiddenRepos.size === 0
        ? board.columns
        : board.columns.map((column) => ({
            ...column,
            items: column.items.filter((item) => !hiddenRepos.has(item.repository)),
          }));

    /**
     * An issue with a pull request open against it is the same piece of work as
     * that pull request, so it gets one card, not two — the pull request's,
     * carrying the issue as a pill. Drafts count: the work exists either way.
     *
     * This runs after the repository filter rather than on the server, so a pull
     * request hidden by the filter stops claiming its issue instead of taking
     * the issue's card off the board with it.
     */
    const claimed = new Set<string>();
    for (const column of visible) {
      if (column.id !== "draft-prs" && column.id !== "open-prs") continue;
      for (const item of column.items) {
        for (const issue of item.linkedIssues) claimed.add(issue.id);
      }
    }
    if (claimed.size === 0) return visible;
    return visible.map((column) =>
      column.id === "issues"
        ? { ...column, items: column.items.filter((item) => !claimed.has(item.id)) }
        : column,
    );
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

  /**
   * Opens the launch dialog on this card, with the card's template already
   * rendered into the first message. Everything else — the project lookup, the
   * provider snapshot, the send itself — belongs to the dialog.
   */
  const openSendDialog = useCallback(
    (item: BoardItem, type: ColumnId) => {
      setNotice(null);
      const projectId = board?.repositoryProjects[item.repository] ?? null;
      const template = prompts === null ? item.url : templateFor(prompts, type, projectId);
      setSendTarget({ item, prompt: renderTemplate(template, item) });
    },
    [board, prompts],
  );

  /**
   * The workspace exists and its agent already has the prompt, so the last
   * thing to do is put the user in front of it. The notice is set first and
   * deliberately: if the app does not route — an old shell, a platform without
   * the app's own scheme — the surface still says where the work went instead of
   * looking like nothing happened.
   */
  const handleLaunched = useCallback(
    (result: LaunchResult) => {
      setSendTarget(null);
      setNotice({
        tone: "info",
        title: "Workspace created",
        text: `“${result.workspaceName}” in ${result.projectName}. Opening it…`,
      });
      selectWorkspaceInApp({
        serverId: props.host.id,
        workspaceId: result.workspaceId,
        agentId: result.agentId,
        platform: props.layout.platform,
        stillHere: () => mounted.current,
      });
    },
    [props.host.id, props.layout.platform],
  );

  const applyLogin = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (trimmed === "" || trimmed === board?.login) return;
      try {
        const { login } = await persistLogin({ login: trimmed });
        await refresh(login);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [board?.login, persistLogin, refresh],
  );

  const applyPrompts = useCallback(
    async (next: PromptSettings) => {
      try {
        const saved = await persistPrompts(next);
        cachedPrompts = saved;
        setPrompts(saved);
        if (cachedBoard !== null) cachedBoard = { ...cachedBoard, prompts: saved };
        setBoard((current) => (current === null ? current : { ...current, prompts: saved }));
      } catch (cause) {
        setNotice({
          tone: "danger",
          title: "Could not save prompts",
          text: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [persistPrompts],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{showSettings ? "GitHub settings" : "GitHub"}</Text>
        {showSettings ? null : repositories.length > 0 ? (
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
        {showSettings ? (
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => setShowSettings(false)}
          >
            <Text style={styles.buttonLabel}>Back to board</Text>
          </Pressable>
        ) : (
          <>
            {board !== null && !props.layout.compact ? (
              <Text style={styles.subtle}>Updated {relativeTime(board.fetchedAt)}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={styles.ghostButton}
              onPress={() => {
                setFilterOpen(false);
                setShowSettings(true);
              }}
            >
              <Text style={styles.ghostButtonLabel}>Configure prompts</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.button}
              onPress={() => void refresh(undefined, true)}
              disabled={busy}
            >
              <Text style={styles.buttonLabel}>{busy ? "Loading…" : "Refresh"}</Text>
            </Pressable>
          </>
        )}
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


      {showSettings ? (
        <PromptSettingsView
          styles={styles}
          prompts={prompts ?? EMPTY_PROMPTS}
          projects={board?.projects ?? NO_PROJECTS}
          login={loginDraft}
          busy={busy}
          mutedColor={props.theme.colors.foregroundMuted}
          onSave={applyPrompts}
          onApplyLogin={applyLogin}
        />
      ) : board === null ? (
        <View style={styles.centered}>
          {busy ? <ActivityIndicator color={props.theme.colors.accent} /> : null}
        </View>
      ) : props.layout.compact ? (
        <ScrollView horizontal contentContainerStyle={styles.columnsContent}>
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              viewerLogin={board.login}
              styles={styles}
              hoverToReveal={hoverToReveal}
              onSend={openSendDialog}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={[styles.columns, styles.columnsContent]}>
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              viewerLogin={board.login}
              styles={styles}
              hoverToReveal={hoverToReveal}
              onSend={openSendDialog}
            />
          ))}
        </View>
      )}

      {sendTarget !== null ? (
        <SendDialog
          // Keyed by card, so opening a second one never inherits the first
          // one's prompt or its half-made choices.
          key={sendTarget.item.id}
          item={sendTarget.item}
          initialPrompt={sendTarget.prompt}
          hostLabel={props.host.label}
          styles={styles}
          accentColor={props.theme.colors.accent}
          onCancel={() => setSendTarget(null)}
          onLaunched={handleLaunched}
        />
      ) : null}

      {notice !== null ? (
        <View style={styles.modalLayer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss message"
            style={styles.modalBackdrop}
            onPress={() => setNotice(null)}
          />
          <View accessibilityRole="alert" accessibilityViewIsModal style={styles.modalCard}>
            <Text style={notice.tone === "danger" ? styles.modalTitleDanger : styles.modalTitle}>
              {notice.title}
            </Text>
            <Text style={styles.modalBody}>{notice.text}</Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => setNotice(null)}
              >
                <Text style={styles.buttonLabel}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
