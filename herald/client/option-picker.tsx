/**
 * A settings row that opens a searchable, scrolling list — for the choices
 * that do not fit the host's `SettingsSelect`, whose popover does not scroll.
 * A Mac lists well over a hundred `say` voices in fifty languages; a browser
 * lists dozens; a daemon lists every model of every provider.
 *
 * Built only from host pieces: `Modal` and `Modal.Content` with scrolling
 * off so the host `FlatList` is the one that scrolls, and the host `TextInput`
 * so the keyboard and the sheet get along on a phone.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { FlatList, Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { SettingsRow } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

export interface PickerOption {
  label: string;
  value: string;
  /** A second, muted line: the language of a voice, the provider of a model. */
  detail?: string;
}

interface OptionPickerProps {
  label: string;
  hint?: string;
  /** The modal's title. */
  title: string;
  value: string;
  options: readonly PickerOption[];
  disabled?: boolean;
  searchPlaceholder?: string;
  onSelect(value: string): void;
  theme: PluginTheme;
  compact: boolean;
}

function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;
}

export function OptionPicker(props: OptionPickerProps) {
  const { theme, compact, options, value, onSelect } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const current = options.find((option) => option.value === value) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return options;
    return options.filter((option) =>
      `${option.label} ${option.detail ?? ""} ${option.value}`.toLowerCase().includes(needle),
    );
  }, [options, query]);

  const styles = useMemo(() => {
    const { colors } = theme;
    const separator = withAlpha(colors.foregroundMuted, "33");
    return {
      trigger: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        maxWidth: compact ? 180 : 280,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: separator,
        backgroundColor: colors.surface1,
      },
      triggerText: { color: colors.foreground, fontSize: 13, flexShrink: 1 },
      triggerDisabled: { opacity: 0.5 },
      body: { flex: 1 },
      content: { flex: 1, padding: compact ? 12 : 16, gap: 10 },
      search: {
        color: colors.foreground,
        fontSize: 15,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: separator,
        backgroundColor: colors.surface1,
      },
      count: { color: colors.foregroundMuted, fontSize: 12 },
      list: { flex: 1 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: separator,
      },
      rowSelected: { backgroundColor: withAlpha(colors.accent, "1a"), borderRadius: 8 },
      rowText: { flex: 1, gap: 2 },
      rowLabel: { color: colors.foreground, fontSize: 15 },
      rowDetail: { color: colors.foregroundMuted, fontSize: 12 },
      empty: { color: colors.foregroundMuted, fontSize: 14, padding: 16, textAlign: "center" as const },
    };
  }, [theme, compact]);

  const muted = theme.colors.foregroundMuted;

  return (
    <>
      <SettingsRow label={props.label} {...(props.hint === undefined ? {} : { hint: props.hint })}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label}: ${current?.label ?? (value === "" ? "not set" : value)}. Change`}
          disabled={props.disabled === true}
          onPress={() => {
            setQuery("");
            setOpen(true);
          }}
          style={[styles.trigger, props.disabled === true ? styles.triggerDisabled : null]}
        >
          <Text style={styles.triggerText} numberOfLines={1}>
            {current?.label ?? (value === "" ? "Choose…" : value)}
          </Text>
          <Icon name="ChevronDown" size={14} color={muted} />
        </Pressable>
      </SettingsRow>
      <Modal title={props.title} open={open} onOpenChange={setOpen}>
        <Modal.Content scrollable={false} style={styles.body} contentContainerStyle={styles.content}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={props.searchPlaceholder ?? "Search"}
            placeholderTextColor={muted}
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus={!compact}
            style={styles.search}
          />
          <Text style={styles.count}>
            {filtered.length === options.length
              ? `${options.length} choices`
              : `${filtered.length} of ${options.length}`}
          </Text>
          <FlatList
            data={filtered}
            keyExtractor={(option) => option.value}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.empty}>Nothing matches.</Text>}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.detail === undefined ? item.label : `${item.label}, ${item.detail}`}
                onPress={() => {
                  onSelect(item.value);
                  setOpen(false);
                }}
                style={[styles.row, item.value === value ? styles.rowSelected : null]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  {item.detail === undefined ? null : <Text style={styles.rowDetail}>{item.detail}</Text>}
                </View>
                {item.value === value ? <Icon name="Check" size={16} color={theme.colors.accent} /> : null}
              </Pressable>
            )}
          />
        </Modal.Content>
      </Modal>
    </>
  );
}
