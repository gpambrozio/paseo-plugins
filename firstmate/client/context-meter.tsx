/**
 * How full the first mate's context window is, drawn beside the chat's
 * buttons the way Paseo's composer draws its own: a ring filling clockwise
 * from the top, coloured at the same thresholds, with the share and the
 * token counts beside it.
 *
 * Paseo's ring is SVG, and `react-native-svg` is not a module a plugin may
 * import, so this one is built from views. Each half of the circle is a clip
 * holding a ring whose border is coloured on two adjacent sides only — a
 * rounded border splits its sides at the diagonals, so that is exactly half a
 * ring — and rotating it slides the coloured half into view: the right clip
 * fills the first 180°, the left clip the rest.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { contextPercent, contextTone, formatTokenCount } from "./format";

/** The icon size the chat's buttons use, and Paseo's stroke. */
const RING_SIZE = 14;
const RING_STROKE = 2;

/**
 * The uncoloured sides of a half ring. Not a colour of the palette, so not
 * a theme token: it is the absence of one, the same in every theme.
 */
const NONE = "transparent";

export function ProgressRing({
  percent,
  color,
  track,
  size = RING_SIZE,
  stroke = RING_STROKE,
}: {
  percent: number;
  color: string;
  track: string;
  size?: number;
  stroke?: number;
}) {
  const share = Math.min(1, Math.max(0, percent / 100));
  const ring = {
    position: "absolute" as const,
    top: 0,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: stroke,
  };
  const half = { position: "absolute" as const, top: 0, width: size / 2, height: size, overflow: "hidden" as const };
  return (
    <View style={{ width: size, height: size }}>
      <View style={[ring, { left: 0, borderColor: track }]} />
      {/*
        Bottom and left coloured: 135°–315°, turned by 45° to sit wholly in the hidden left half, then on by
        the share. Not drawn at all for nothing used, where its edge would show as a hairline on the seam.
      */}
      {share === 0 ? null : (
        <View style={[half, { left: size / 2 }]}>
          <View
            style={[
              ring,
              {
                left: -size / 2,
                borderColor: NONE,
                borderBottomColor: color,
                borderLeftColor: color,
                transform: [{ rotate: `${45 + Math.min(share, 0.5) * 360}deg` }],
              },
            ]}
          />
        </View>
      )}
      {share <= 0.5 ? null : (
        // Top and right coloured: -45°–135°, turned by 45° to sit wholly in the hidden right half, then on.
        <View style={[half, { left: 0 }]}>
          <View
            style={[
              ring,
              {
                left: 0,
                borderColor: NONE,
                borderTopColor: color,
                borderRightColor: color,
                transform: [{ rotate: `${45 + (share - 0.5) * 360}deg` }],
              },
            ]}
          />
        </View>
      )}
    </View>
  );
}

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
        paddingHorizontal: 6,
      },
      label: { color: colors.foregroundMuted, fontSize: 11 },
      percent: { color: tone, fontWeight: "600" as const },
    };
  }, [theme, tone]);

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
      <ProgressRing percent={percent} color={tone} track={theme.colors.border} />
      <Text style={styles.label}>
        <Text style={styles.percent}>{rounded}%</Text>
        {compact ? null : ` · ${tokens}`}
      </Text>
    </View>
  );
}
