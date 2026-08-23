import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { loadBoard, saveLogin } from "./board.shared";

/** Width of one column when columns scroll horizontally instead of sharing the row. */
const COMPACT_COLUMN_WIDTH = 300;

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

function Card({ item, styles }: { item: BoardItem; styles: Styles }) {
  const open = useCallback(() => {
    void Linking.openURL(item.url);
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

  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [loginDraft, setLoginDraft] = useState("");

  const refresh = useCallback(
    async (login?: string) => {
      setBusy(true);
      setError(null);
      try {
        const next = await load(login === undefined ? {} : { login });
        setBoard(next);
        setLoginDraft(next.login);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
        <View style={styles.headerSpacer} />
        {board !== null && !props.layout.compact ? (
          <Text style={styles.subtle}>Updated {relativeTime(board.fetchedAt)}</Text>
        ) : null}
        <Pressable style={styles.button} onPress={() => void refresh()} disabled={busy}>
          <Text style={styles.buttonLabel}>{busy ? "Loading…" : "Refresh"}</Text>
        </Pressable>
      </View>

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
          {board.columns.map((column) => (
            <Column key={column.id} column={column} styles={styles} />
          ))}
        </ScrollView>
      ) : (
        <View style={[styles.columns, styles.columnsContent]}>
          {board.columns.map((column) => (
            <Column key={column.id} column={column} styles={styles} />
          ))}
        </View>
      )}
    </View>
  );
}
