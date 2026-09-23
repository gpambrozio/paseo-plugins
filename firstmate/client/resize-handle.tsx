/**
 * The strip between the chat and the board. Dragging it moves the split; the
 * width is kept as a share of the surface, and saved once per drag rather
 * than once per pixel.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, View } from "react-native";

import { trackPointerOnDocument } from "./web";

const MIN_SHARE = 0.2;
const MAX_SHARE = 0.8;

export function clampShare(share: number): number {
  return Math.min(MAX_SHARE, Math.max(MIN_SHARE, share));
}

export function ResizeHandle({
  theme,
  share,
  totalWidth,
  onChange,
  onCommit,
}: {
  theme: PluginTheme;
  share: number;
  totalWidth: number;
  onChange: (share: number) => void;
  onCommit: (share: number) => void;
}) {
  const [active, setActive] = useState(false);
  /** Read inside the responder, which is created once and must see the latest values. */
  const latest = useRef({ share, totalWidth, onChange, onCommit });
  latest.current = { share, totalWidth, onChange, onCommit };
  const stopTracking = useRef<() => void>(() => {});
  useEffect(() => () => stopTracking.current(), []);

  const responder = useMemo(() => {
    let start: { share: number; x: number } | null = null;
    let moved: number | null = null;
    const apply = (dx: number) => {
      const width = latest.current.totalWidth;
      if (start === null || width <= 0) return;
      moved = clampShare(start.share + dx / width);
      latest.current.onChange(moved);
    };
    const finish = () => {
      stopTracking.current();
      stopTracking.current = () => {};
      const committed = moved;
      start = null;
      moved = null;
      setActive(false);
      if (committed !== null) latest.current.onCommit(committed);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Every scroll view the pointer crosses asks for the responder; the
      // default answer — yes — stops the drag partway.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        const x = event.nativeEvent.pageX;
        start = { share: latest.current.share, x };
        setActive(true);
        stopTracking.current = trackPointerOnDocument((clientX) => apply(clientX - x), finish);
      },
      onPanResponderMove: (_event, gesture) => apply(gesture.dx),
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, []);

  const styles = useMemo(
    () => ({
      hit: { width: 9, alignItems: "center" as const, justifyContent: "center" as const },
      line: { width: active ? 3 : 1, alignSelf: "stretch" as const, backgroundColor: active ? theme.colors.accent : theme.colors.border },
    }),
    [theme, active],
  );

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="Resize the chat"
      style={styles.hit}
      {...responder.panHandlers}
    >
      <View style={styles.line} />
    </View>
  );
}
