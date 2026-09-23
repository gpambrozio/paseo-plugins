/**
 * How full the first mate's context window is, drawn beside the chat's
 * buttons the way Paseo's composer draws its own: the share used, coloured at
 * the same thresholds, with the token counts. Paseo's is an SVG ring, and
 * `react-native-svg` is not a module a plugin may import, so this is a bar.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { contextPercent, contextTone, formatTokenCount } from "./format";

export function ContextMeter({
  theme,
  used,
  max,
  compact,
}: {
  theme: PluginTheme;
  used: number | null | undefined;
  max: number | null | undefined;
  /** Drops the token counts, which a phone's button row has no room for. */
  compact: boolean;
}) {
  const percent = contextPercent(used, max);
  const tone = contextTone(theme, percent ?? 0);
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      meter: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        height: 28,
        paddingHorizontal: 8,
      },
      track: {
        width: compact ? 32 : 44,
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.surface2,
        overflow: "hidden" as const,
      },
      fill: { height: 6, borderRadius: 3, backgroundColor: tone },
      label: { color: colors.foregroundMuted, fontSize: 11 },
      percent: { color: tone, fontWeight: "600" as const },
    };
  }, [theme, compact, tone]);

  if (percent === null || typeof used !== "number" || typeof max !== "number") return null;
  const rounded = Math.round(percent);
  const tokens = `${formatTokenCount(used)} / ${formatTokenCount(max)}`;
  return (
    <View
      style={styles.meter}
      accessibilityRole="progressbar"
      accessibilityLabel={`Context window ${rounded}% used, ${tokens} tokens`}
      accessibilityValue={{ min: 0, max: 100, now: Math.min(100, rounded) }}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, percent))}%` }]} />
      </View>
      <Text style={styles.label}>
        <Text style={styles.percent}>{rounded}%</Text>
        {compact ? null : ` · ${tokens}`}
      </Text>
    </View>
  );
}
