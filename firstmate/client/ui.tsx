/**
 * The few pieces every FirstMate screen draws with. The host kit has settings
 * rows and a modal but no button, so these are built from `Pressable`, with
 * every colour taken from the theme.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";

/** A fixed-width font on every platform; iOS has no font named "monospace". */
export const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

export type Tone = "default" | "accent" | "danger";

export function IconButton({
  icon,
  label,
  theme,
  onPress,
  tone = "default",
  disabled = false,
  showLabel = false,
}: {
  icon: string;
  label: string;
  theme: PluginTheme;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  /** Draws the label beside the icon; otherwise it is only the accessibility label. */
  showLabel?: boolean;
}) {
  const colors = theme.colors;
  const color =
    tone === "accent" ? colors.accentForeground : tone === "danger" ? colors.statusDanger : colors.foreground;
  const styles = useMemo(
    () => ({
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: showLabel ? 10 : 7,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: tone === "accent" ? colors.accent : colors.border,
        backgroundColor: tone === "accent" ? colors.accent : colors.surface1,
        opacity: disabled ? 0.5 : 1,
      },
      label: { color, fontSize: 12, fontWeight: "500" as const },
    }),
    [colors, tone, disabled, showLabel, color],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.button}
    >
      <Icon name={icon} size={14} color={color} />
      {showLabel ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  );
}

/**
 * A two-or-more-way switch, drawn to sit in a row of `IconButton`s: the same
 * 28-point height (a 14-point icon, 6 points of padding each side, a 1-point
 * border), radius and border, with the selected segment in the accent colour.
 */
export function Segmented<Value extends string>({
  theme,
  value,
  options,
  onChange,
}: {
  theme: PluginTheme;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string }>;
  onChange: (value: Value) => void;
}) {
  const colors = theme.colors;
  const styles = useMemo(
    () => ({
      frame: {
        flexDirection: "row" as const,
        height: 28,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        overflow: "hidden" as const,
      },
      segment: { justifyContent: "center" as const, paddingHorizontal: 12 },
      selected: { backgroundColor: colors.accent },
      label: { color: colors.foreground, fontSize: 12, fontWeight: "500" as const },
      labelSelected: { color: colors.accentForeground, fontWeight: "600" as const },
    }),
    [colors],
  );
  return (
    <View style={styles.frame} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segment, selected ? styles.selected : null]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.label, selected ? styles.labelSelected : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The round button over a transcript's foot that goes back to its end, shown
 * while the reader is scrolled away from it — as in Paseo's own agent view.
 * Its parent must be the transcript's frame; it positions itself in it.
 */
export function JumpToEnd({ theme, onPress }: { theme: PluginTheme; onPress: () => void }) {
  const colors = theme.colors;
  const styles = useMemo(
    () => ({
      frame: { position: "absolute" as const, left: 0, right: 0, bottom: 12, alignItems: "center" as const },
      button: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
    }),
    [colors],
  );
  return (
    <View style={styles.frame} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Scroll to the latest" onPress={onPress} style={styles.button}>
        <Icon name="ChevronDown" size={20} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

/** The box of `ActivityIndicator`'s "small" size, which the spinner is scaled down from. */
const SMALL_SPINNER = 20;

/**
 * Something running, drawn the size of the icon it stands in for. Lucide's
 * Loader is a spinner drawn standing still, and at a glance a still spinner
 * reads as broken; React Native's own `ActivityIndicator` turns on every
 * platform. It has only two sizes, so the small one is scaled into a box of
 * the icon's size, keeping the row it sits in the same height.
 */
export function Spinner({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: size / SMALL_SPINNER }] }} />
    </View>
  );
}

/** A full-width notice under the header. */
export function Banner({
  theme,
  tone,
  text,
  action,
}: {
  theme: PluginTheme;
  tone: "warning" | "danger" | "info";
  text: string;
  action?: { label: string; icon: string; onPress: () => void; disabled?: boolean };
}) {
  const colors = theme.colors;
  const color =
    tone === "danger" ? colors.statusDanger : tone === "warning" ? colors.statusWarning : colors.foregroundMuted;
  const styles = useMemo(
    () => ({
      banner: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        borderWidth: 1,
        borderColor: color,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: colors.surface1,
      },
      text: { flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 17 },
    }),
    [colors, color],
  );
  return (
    <View style={styles.banner}>
      <Icon name={tone === "info" ? "Info" : "AlertTriangle"} size={14} color={color} />
      <Text style={styles.text}>{text}</Text>
      {action === undefined ? null : (
        <IconButton
          icon={action.icon}
          label={action.label}
          theme={theme}
          tone="accent"
          showLabel
          disabled={action.disabled === true}
          onPress={action.onPress}
        />
      )}
    </View>
  );
}

/** A small rounded label, coloured by what it describes. */
export function Chip({ theme, text, color }: { theme: PluginTheme; text: string; color: string }) {
  const styles = useMemo(
    () => ({
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color },
      text: { color: theme.colors.foreground, fontSize: 11 },
    }),
    [theme, color],
  );
  return (
    <View style={styles.chip}>
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export { errorText } from "./format";
