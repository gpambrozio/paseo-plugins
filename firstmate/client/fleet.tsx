/**
 * The FirstMate surface: the conversation with the first mate beside the
 * board of its crew.
 *
 * Everything on it comes from one RPC, `firstmate.fleet.load`, polled at the
 * interval in the display settings and refetched right after any action. The
 * chat reads the first mate's timeline directly and streams.
 *
 * A surface is unmounted whenever the captain opens a workspace, so the last
 * fleet and the compact tab live in module scope and the board comes back
 * drawn rather than empty.
 */
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { enableAgentTools, loadFleet, markMateSeen, type ColumnId, type Fleet } from "../shared/fleet";
import { displaySettings, type DisplaySettings } from "../shared/settings";
import { Board } from "./board";
import { MateChat } from "./chat";
import { agentStatusLabel, agentStatusTone, groupCards, moveColumn, orderedColumns, shortPath } from "./format";
import { LaunchPanel } from "./launch";
import { ResizeHandle, clampShare } from "./resize-handle";
import { Banner, Chip, IconButton, errorText } from "./ui";

export const FLEET_QUERY_KEY = ["firstmate", "fleet"] as const;

let cachedFleet: Fleet | null = null;
let cachedTab: "chat" | "board" = "chat";

/**
 * A surface is given no way to open a settings screen, so the entry lends it
 * one; the gear is hidden while nothing is bound. Cleared in the entry's
 * cleanup, since this module outlives a disconnected client's context.
 */
let openSettings: ((id: string) => void) | null = null;
export function bindSettingsOpener(opener: ((id: string) => void) | null): void {
  openSettings = opener;
}

const DEFAULT_DISPLAY: DisplaySettings = displaySettings.schema.parse({});
const SAVE_DELAY_MS = 400;

/** The fleet query, shared by the surface and the workspace panels so they poll once between them. */
export function useFleet(pollSeconds: number) {
  const load = useRpc(loadFleet);
  return useQuery({
    queryKey: FLEET_QUERY_KEY,
    queryFn: function () {
      return load({}).then((fleet) => {
        cachedFleet = fleet;
        return fleet;
      });
    },
    refetchInterval: pollSeconds * 1000,
    ...(cachedFleet === null ? {} : { placeholderData: cachedFleet }),
  });
}

export function FleetSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const compact = layout.compact;
  const enable = useRpc(enableAgentTools);
  const toast = useToast();
  const queryClient = useQueryClient();
  const display = useSettings(displaySettings);
  const saved = display.status === "ready" ? display.values : DEFAULT_DISPLAY;

  /** Drawn at once and saved behind, so a fold or a drag never waits on a round trip. */
  const [override, setOverride] = useState<Partial<DisplaySettings>>({});
  const values: DisplaySettings = { ...saved, ...override };
  const [share, setShare] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const [tab, setTabState] = useState(cachedTab);
  const [enabling, setEnabling] = useState(false);

  const fleet = useFleet(values.pollSeconds);
  const data = fleet.data ?? null;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY });
  }, [queryClient]);

  /**
   * Layout changes are drawn at once and saved behind, batched: a save is
   * checked against the document revision it was made from, so a second fold
   * sent before the first came back would be refused as stale. Changes inside
   * `SAVE_DELAY_MS` become one save, made from whatever revision is current
   * when it goes out, and a refused one is tried once more from the next.
   */
  const displayRef = useRef(display);
  displayRef.current = display;
  const pending = useRef<Partial<DisplaySettings>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function flush(attempt: number): void {
    const current = displayRef.current;
    if (current.status !== "ready") return;
    const patch = pending.current;
    pending.current = {};
    void current.save({ ...current.values, ...patch }, current.revision).then((ok) => {
      if (ok) return;
      if (attempt === 0) {
        pending.current = { ...patch, ...pending.current };
        saveTimer.current = setTimeout(() => flush(1), SAVE_DELAY_MS);
      } else {
        console.warn("[firstmate] could not save the board layout:", displayRef.current.saveError);
      }
    });
  }

  function save(patch: Partial<DisplaySettings>): void {
    setOverride((current) => ({ ...current, ...patch }));
    pending.current = { ...pending.current, ...patch };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flush(0), SAVE_DELAY_MS);
  }

  // Once the stored document says what was drawn, the local copy has done its
  // job; dropping it lets a change made on another device show here.
  useEffect(() => {
    if (display.status !== "ready") return;
    setOverride((current) => {
      const entries = Object.entries(current).filter(
        ([key, value]) => JSON.stringify(display.values[key as keyof DisplaySettings]) !== JSON.stringify(value),
      );
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  }, [display]);

  function setTab(next: "chat" | "board"): void {
    cachedTab = next;
    setTabState(next);
  }

  const order = orderedColumns(values.columnOrder);
  const counts = useMemo(() => {
    const groups = groupCards(data?.cards ?? []);
    return {
      working: groups.get("working")?.length ?? 0,
      blocked: groups.get("blocked")?.length ?? 0,
      queued: groups.get("queued")?.length ?? 0,
      done: groups.get("done")?.length ?? 0,
    };
  }, [data]);

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      header: {
        paddingHorizontal: compact ? 12 : 16,
        paddingTop: compact ? 10 : 14,
        paddingBottom: 8,
        gap: 4,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      headerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
      title: { color: colors.foreground, fontSize: compact ? 17 : 20, fontWeight: "600" as const },
      spacer: { flex: 1 },
      meta: { color: colors.foregroundMuted, fontSize: 12 },
      banners: { paddingHorizontal: compact ? 12 : 16, paddingTop: 8, gap: 6 },
      split: { flex: 1, minHeight: 0, flexDirection: "row" as const },
      rail: {
        width: 40,
        alignItems: "center" as const,
        paddingTop: 10,
        backgroundColor: colors.surface1,
        borderColor: colors.border,
      },
      tabs: {
        flexDirection: "row" as const,
        margin: 10,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        overflow: "hidden" as const,
      },
      tab: { flex: 1, paddingVertical: 7, alignItems: "center" as const },
      tabActive: { backgroundColor: colors.accent },
      tabText: { color: colors.foreground, fontSize: 13 },
      tabTextActive: { color: colors.accentForeground, fontWeight: "600" as const },
      loading: { color: colors.foregroundMuted, fontSize: 13, padding: 20 },
    };
  }, [theme, compact]);

  const mate = data?.mate ?? null;

  /**
   * While this surface is open the captain is looking at the first mate, so
   * its "finished" flag is cleared the way opening it in Paseo would clear it,
   * and its workspace reads as done in the sidebar. Keyed by `updatedAt`, so a
   * turn that ends while the panel is open is cleared too, and a clear that
   * failed is not retried until something changes. A pending permission is
   * left flagged; the server checks that again.
   */
  const markSeen = useRpc(markMateSeen);
  const unseen =
    mate !== null && mate.requiresAttention && mate.pendingPermissions === 0 ? `${mate.id}:${mate.updatedAt}` : null;
  useEffect(() => {
    if (unseen === null) return;
    markSeen({})
      .then((result) => {
        if (result.cleared) refresh();
      })
      .catch((caught: unknown) => {
        console.warn("[firstmate] could not mark the first mate as seen:", caught);
      });
  }, [unseen, markSeen, refresh]);

  const openMate =
    mate === null || navigation === undefined ? null : () => navigation.openAgent({ agentId: mate.id });

  function turnOnTools(): void {
    setEnabling(true);
    enable({})
      .then((result) => {
        toast.show(
          result.agentTools
            ? mate === null
              ? "Agent tools are on."
              : "Agent tools are on. The first mate gets them the next time its session starts — reload it from its tab."
            : "The daemon did not keep the change.",
          { variant: result.agentTools ? "success" : "warning" },
        );
        refresh();
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setEnabling(false));
  }

  const banners: ReactNode[] = [];
  if (fleet.error !== null) {
    banners.push(<Banner key="error" theme={theme} tone="danger" text={errorText(fleet.error)} />);
  }
  if (data?.agentTools === false) {
    banners.push(
      <Banner
        key="tools"
        theme={theme}
        tone="warning"
        text="The first mate starts its crew and hears back from it through Paseo's agent tools, and this daemon does not give agents those tools."
        action={{ label: enabling ? "Turning on…" : "Turn them on", icon: "Wrench", onPress: turnOnTools, disabled: enabling }}
      />,
    );
  }
  if (data?.mateMissing === true) {
    banners.push(
      <Banner
        key="missing"
        theme={theme}
        tone="info"
        text="The first mate you had is gone — archived or deleted. Launch a new one; its records are still in its home."
      />,
    );
  }
  if (mate !== null && data !== null && !data.mateInHome) {
    banners.push(
      <Banner
        key="cwd"
        theme={theme}
        tone="warning"
        text={`The first mate works in ${shortPath(mate.cwd, 60)}, not in its home, so it has not read its charter there.`}
      />,
    );
  }
  // The question itself is in the chat; the banner is for when the chat is
  // out of sight — folded away, or behind the Crew tab on a phone.
  const chatHidden = compact ? tab !== "chat" : values.chatCollapsed;
  if (mate !== null && mate.pendingPermissions > 0 && chatHidden) {
    banners.push(
      <Banner
        key="permission"
        theme={theme}
        tone="warning"
        text="The first mate is waiting for your answer."
        action={{
          label: "Show",
          icon: "MessageSquare",
          onPress: () => (compact ? setTab("chat") : save({ chatCollapsed: false })),
        }}
      />,
    );
  }
  for (const warning of data?.warnings ?? []) {
    banners.push(<Banner key={warning} theme={theme} tone="warning" text={warning} />);
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Icon name="Ship" size={compact ? 16 : 18} color={theme.colors.foreground} />
        <Text style={styles.title}>FirstMate</Text>
        {mate === null ? null : (
          <Chip theme={theme} text={`First mate · ${agentStatusLabel(mate)}`} color={agentStatusTone(theme, mate)} />
        )}
        <View style={styles.spacer} />
        {!compact && mate !== null ? (
          <>
            <IconButton
              icon={values.chatCollapsed ? "PanelLeftOpen" : "PanelLeftClose"}
              label={values.chatCollapsed ? "Show the chat" : "Hide the chat"}
              theme={theme}
              onPress={() => save({ chatCollapsed: !values.chatCollapsed, boardCollapsed: false })}
            />
            <IconButton
              icon={values.boardCollapsed ? "PanelRightOpen" : "PanelRightClose"}
              label={values.boardCollapsed ? "Show the board" : "Hide the board"}
              theme={theme}
              onPress={() => save({ boardCollapsed: !values.boardCollapsed, chatCollapsed: false })}
            />
          </>
        ) : null}
        {openMate === null ? null : (
          <IconButton icon="ExternalLink" label="Open the first mate in Paseo" theme={theme} onPress={openMate} />
        )}
        <IconButton
          icon="RefreshCw"
          label={fleet.isFetching ? "Refreshing" : "Refresh"}
          theme={theme}
          disabled={fleet.isFetching}
          onPress={refresh}
        />
        {openSettings === null ? null : (
          <IconButton icon="Settings" label="FirstMate settings" theme={theme} onPress={() => openSettings?.("firstmate")} />
        )}
      </View>
      {data === null ? null : (
        <Text style={styles.meta} numberOfLines={1}>
          {[
            `${counts.working} working`,
            `${counts.blocked} blocked`,
            `${counts.queued} queued`,
            `${counts.done} done`,
            shortPath(data.home, compact ? 28 : 56),
          ].join(" · ")}
        </Text>
      )}
    </View>
  );

  if (data === null) {
    return (
      <View style={styles.screen}>
        {header}
        {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
        <Text style={styles.loading}>{fleet.error === null ? "Mustering the crew…" : ""}</Text>
      </View>
    );
  }

  if (mate === null) {
    return (
      <View style={styles.screen}>
        {header}
        <ScrollView automaticallyAdjustKeyboardInsets>
          {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
          <LaunchPanel theme={theme} compact={compact} home={data.home} onLaunched={refresh} />
        </ScrollView>
      </View>
    );
  }

  const board = (
    <Board
      cards={data.cards}
      order={order}
      collapsed={values.collapsedColumns}
      theme={theme}
      compact={compact}
      navigation={navigation}
      onChanged={refresh}
      onToggleColumn={(id: ColumnId) =>
        save({
          collapsedColumns: values.collapsedColumns.includes(id)
            ? values.collapsedColumns.filter((column) => column !== id)
            : [...values.collapsedColumns, id],
        })
      }
      onMoveColumn={(id: ColumnId, delta: number) => save({ columnOrder: moveColumn(order, id, delta) })}
    />
  );
  const chat = <MateChat key={mate.id} mate={mate} theme={theme} compact={compact} onOpen={openMate} />;

  if (compact) {
    return (
      <View style={styles.screen}>
        {header}
        {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
        <View style={styles.tabs}>
          {(["chat", "board"] as const).map((id) => (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === id }}
              style={[styles.tab, tab === id ? styles.tabActive : null]}
              onPress={() => setTab(id)}
            >
              <Text style={[styles.tabText, tab === id ? styles.tabTextActive : null]}>
                {id === "chat" ? "First mate" : `Crew (${data.cards.length})`}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flex: 1, minHeight: 0 }}>{tab === "chat" ? chat : board}</View>
      </View>
    );
  }

  const chatShare = clampShare(share ?? values.chatWidthFraction);
  return (
    <View style={styles.screen}>
      {header}
      {banners.length === 0 ? null : <View style={styles.banners}>{banners}</View>}
      <View style={styles.split} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {values.chatCollapsed ? (
          <View style={[styles.rail, { borderRightWidth: 1 }]}>
            <IconButton
              icon="PanelLeftOpen"
              label="Show the chat"
              theme={theme}
              onPress={() => save({ chatCollapsed: false })}
            />
          </View>
        ) : (
          <View style={values.boardCollapsed ? { flex: 1 } : { width: Math.round(chatShare * width) }}>{chat}</View>
        )}
        {values.chatCollapsed || values.boardCollapsed ? null : (
          <ResizeHandle
            theme={theme}
            share={chatShare}
            totalWidth={width}
            onChange={setShare}
            onCommit={(next) => {
              save({ chatWidthFraction: next });
              setShare(null);
            }}
          />
        )}
        {values.boardCollapsed ? (
          <View style={[styles.rail, { borderLeftWidth: 1 }]}>
            <IconButton
              icon="PanelRightOpen"
              label="Show the board"
              theme={theme}
              onPress={() => save({ boardCollapsed: false })}
            />
          </View>
        ) : (
          <View style={{ flex: 1, minWidth: 0 }}>{board}</View>
        )}
      </View>
    </View>
  );
}
