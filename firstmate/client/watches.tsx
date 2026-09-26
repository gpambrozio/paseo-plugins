/**
 * The home's watch scripts: one row each with its schedule, how its last run went and what it last
 * printed, and a switch that turns it off or on. The scripts themselves are edited as files, in the
 * Files view; nothing here writes one.
 *
 * A watch's name opens its script in the Files view, which is where it is edited.
 *
 * Drawn as a card after the columns on a wide board, and at the foot of the Crew tab on a phone.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { toggleWatch, watchPath, type WatchSummary } from "../shared/fleet";
import { errorText, watchStatusText, watchTone } from "./format";
import { MONOSPACE } from "./ui";

export const WATCHES_TITLE = "Watches";
export const WATCHES_ICON = "Radar";

export function WatchList({
  watches,
  theme,
  onChanged,
  onOpenFile,
}: {
  watches: readonly WatchSummary[];
  theme: PluginTheme;
  /** A watch was switched; the board should load again. */
  onChanged: () => void;
  /** Opens a home file in the Files view; a watch's name opens its script. */
  onOpenFile: (path: string) => void;
}) {
  const toggle = useRpc(toggleWatch);
  const toast = useToast();
  /** Switched here and not yet reloaded, so the switch moves at once. */
  const [switched, setSwitched] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<string | null>(null);

  // A switch the board has caught up with is the board's again, so a change from elsewhere shows.
  useEffect(() => {
    setSwitched((current) => {
      const left = Object.fromEntries(
        Object.entries(current).filter(([name, enabled]) =>
          watches.some((watch) => watch.name === name && watch.enabled !== enabled),
        ),
      );
      return Object.keys(left).length === Object.keys(current).length ? current : left;
    });
  }, [watches]);

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      list: { gap: 8 },
      row: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        backgroundColor: colors.surface2,
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 4,
      },
      head: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      dot: { width: 7, height: 7, borderRadius: 4 },
      nameButton: { flex: 1, minWidth: 0 },
      name: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const, textDecorationLine: "underline" as const },
      schedule: { color: colors.foregroundMuted, fontSize: 11, fontFamily: MONOSPACE },
      status: { color: colors.foregroundMuted, fontSize: 12 },
      problem: { color: colors.statusDanger, fontSize: 12 },
      note: { color: colors.statusWarning, fontSize: 12 },
      output: { color: colors.foreground, fontSize: 11, fontFamily: MONOSPACE, lineHeight: 15 },
      more: { color: colors.foregroundMuted, fontSize: 11 },
    };
  }, [theme]);

  function setEnabled(watch: WatchSummary, enabled: boolean): void {
    setSwitched((current) => ({ ...current, [watch.name]: enabled }));
    toggle({ name: watch.name, enabled })
      .then(() => onChanged())
      .catch((caught: unknown) => {
        toast.error(errorText(caught));
        setSwitched((current) => {
          const { [watch.name]: _dropped, ...rest } = current;
          return rest;
        });
      });
  }

  return (
    <View style={styles.list}>
      {watches.map((served) => {
        const pending = switched[served.name];
        const watch = pending === undefined ? served : { ...served, enabled: pending };
        const expanded = open === watch.name;
        const problem = watch.invalid ?? (watch.lastResult === "failed" ? watch.lastError : null);
        return (
          <View key={watch.name} style={styles.row}>
            <View style={styles.head}>
              <View style={[styles.dot, { backgroundColor: watchTone(theme, watch) }]} />
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open ${watch.name} in Files`}
                style={styles.nameButton}
                onPress={() => onOpenFile(watchPath(watch.name))}
              >
                <Text style={styles.name} numberOfLines={1}>
                  {watch.name}
                </Text>
              </Pressable>
              {watch.schedule === null ? null : (
                <Text style={styles.schedule} numberOfLines={1}>
                  {watch.schedule}
                </Text>
              )}
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel={`${watch.name} is ${watch.enabled ? "on" : "off"}; switch it ${watch.enabled ? "off" : "on"}`}
                accessibilityState={{ checked: watch.enabled }}
                hitSlop={6}
                onPress={() => setEnabled(watch, !watch.enabled)}
              >
                <Icon
                  name={watch.enabled ? "ToggleRight" : "ToggleLeft"}
                  size={20}
                  color={watch.enabled ? theme.colors.accent : theme.colors.foregroundMuted}
                />
              </Pressable>
            </View>
            <Text style={styles.status} numberOfLines={1}>
              {watchStatusText(watch)}
            </Text>
            {problem === null ? null : (
              <Text style={styles.problem} numberOfLines={expanded ? undefined : 2}>
                {problem}
              </Text>
            )}
            {watch.outdated ? (
              <Text style={styles.note}>
                Edited here; FirstMate's own version has changed since. Delete the file to take the new one.
              </Text>
            ) : null}
            {watch.lastOutput === null ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={expanded ? "Show less of the last output" : "Show all of the last output"}
                onPress={() => setOpen(expanded ? null : watch.name)}
              >
                <Text style={styles.output} numberOfLines={expanded ? undefined : 3}>
                  {watch.lastOutput}
                </Text>
                <Text style={styles.more}>
                  {expanded ? "Show less" : "Last output — show all"}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}
