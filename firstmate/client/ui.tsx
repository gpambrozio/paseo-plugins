/**
 * The few pieces every FirstMate screen draws with. The host kit has settings
 * rows and a modal but no button, so these are built from `Pressable`, with
 * every colour taken from the theme.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

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

export function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
