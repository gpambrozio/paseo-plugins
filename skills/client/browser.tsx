import { type PluginHostProps, useAgent, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { z } from "zod";

import { invocationText, sendInvocation } from "./invoke";
import { useSkillsQuery } from "./skills-query";
import { readSkill, ReportedSkillSchema, SkillEntrySchema } from "../shared/skills";

type Theme = PluginHostProps["theme"];
type Skill = z.infer<typeof SkillEntrySchema>;
type ReportedSkill = z.infer<typeof ReportedSkillSchema>;

type Selection = { kind: "discovered"; id: string } | { kind: "reported"; name: string };

// Menlo does not exist on Android, where an unknown family silently falls back
// to the default proportional font.
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

// Groups render in resolver-precedence order, not in whatever order the
// alphabetically-sorted skill list happens to introduce them.
const SOURCE_ORDER: ReadonlyArray<Skill["source"]["kind"]> = [
  "project",
  "repo",
  "personal",
  "admin",
  "plugin",
];

function groupBySource(skills: Skill[]): Array<{ label: string; skills: Skill[] }> {
  const groups = new Map<string, { kind: Skill["source"]["kind"]; skills: Skill[] }>();
  for (const skill of skills) {
    const existing = groups.get(skill.source.label);
    if (existing) existing.skills.push(skill);
    else groups.set(skill.source.label, { kind: skill.source.kind, skills: [skill] });
  }
  return [...groups]
    .sort(([labelA, groupA], [labelB, groupB]) => {
      const rank = SOURCE_ORDER.indexOf(groupA.kind) - SOURCE_ORDER.indexOf(groupB.kind);
      return rank !== 0 ? rank : labelA.localeCompare(labelB);
    })
    .map(([label, group]) => ({ label, skills: group.skills }));
}

/**
 * Where the browser is drawn. The panel is a whole tab, so it scrolls and
 * paints its own background. A composer pill's popover is a host surface that
 * already scrolls, pads and paints, so the browser draws only its content there:
 * a second scroll view inside the host's would fight it for the gesture.
 */
export type SkillBrowserFrame = "screen" | "popover";

/**
 * How many lines a detail screen's long texts get in each frame; `undefined` is
 * all of them.
 *
 * The popover's pages share the host's one scroll view, and nothing in the
 * plugin API can move its offset — so a detail opened from far down a long list
 * would keep that offset and open with its back link, arguments and Invoke out
 * of view. Capping the detail keeps it within the popover's height, which leaves
 * the host no room to scroll: the offset falls back to the top, and the list
 * returned to from there starts at the top too. The Skills tab shows it all.
 */
function detailLines(frame: SkillBrowserFrame) {
  return frame === "popover"
    ? { description: 4, body: 6 }
    : { description: undefined, body: undefined };
}

function Frame({
  frame,
  theme,
  padding,
  children,
}: {
  frame: SkillBrowserFrame;
  theme: Theme;
  padding: number;
  children: ReactNode;
}) {
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding },
    }),
    [theme, padding],
  );
  if (frame === "popover") return <View>{children}</View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  );
}

function detailStyles(theme: Theme, padding: number) {
  return {
    back: { color: theme.colors.accent, marginBottom: padding },
    name: { color: theme.colors.foreground, fontSize: 18, marginBottom: 4 },
    description: { color: theme.colors.foregroundMuted, marginBottom: padding },
    path: { color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: MONO },
    copy: { color: theme.colors.accent, marginTop: 4, marginBottom: padding },
    argsInput: {
      color: theme.colors.foreground,
      borderWidth: 1,
      borderColor: theme.colors.foregroundMuted,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 8,
    },
    invoke: {
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center" as const,
      marginBottom: padding,
    },
    invokeLabel: { color: theme.colors.accentForeground, fontSize: 15 },
    body: { color: theme.colors.foreground, fontFamily: MONO, fontSize: 12 },
    error: { color: theme.colors.statusDanger, marginBottom: padding },
    notInvocable: { color: theme.colors.foregroundMuted, marginBottom: padding },
  };
}

type DetailStyles = ReturnType<typeof detailStyles>;

/**
 * Owns the arguments field and the send. The re-entrancy guard lives here rather
 * than in each detail screen: a double tap on a slow connection would otherwise
 * invoke the skill twice on the user's live agent.
 *
 * `onInvoked` is deliberately not `onBack`. Both used to be the same callback,
 * which meant a successful invoke left the user on the Skills tab watching the
 * list — the turn it had just started was one tab away, with nothing saying so.
 */
function useInvoke(agentId: string, onInvoked: () => void) {
  const paseo = usePaseo();
  const toast = useToast();
  const [args, setArgs] = useState("");
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [isInvoking, setIsInvoking] = useState(false);

  // Whether this detail screen is still the one on show; a send outlives it when
  // the user goes back or the popover closes. See `sendInvocation`.
  const showing = useRef(false);
  useEffect(() => {
    showing.current = true;
    return () => {
      showing.current = false;
    };
  }, []);

  async function invoke(name: string) {
    if (isInvoking) return;
    setIsInvoking(true);
    setInvokeError(null);
    await sendInvocation({
      send: (text) => paseo.agents.ref(agentId).send(text),
      text: invocationText(name, args),
      isShowing: () => showing.current,
      onSent: onInvoked,
      onFailure(message) {
        setInvokeError(message);
        setIsInvoking(false);
      },
      onUnseenFailure(message) {
        toast.error(`Could not invoke /${name}: ${message}`);
      },
    });
  }

  return { args, setArgs, invoke, invokeError, isInvoking };
}

/** The arguments field, error line, and Invoke button, shared by both detail screens. */
function InvokeControls({
  styles,
  theme,
  name,
  controls,
}: {
  styles: DetailStyles;
  theme: Theme;
  name: string;
  controls: ReturnType<typeof useInvoke>;
}) {
  return (
    <>
      <TextInput
        style={styles.argsInput}
        value={controls.args}
        onChangeText={controls.setArgs}
        placeholder="Arguments (optional)"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCorrect={false}
      />
      {controls.invokeError ? <Text style={styles.error}>{controls.invokeError}</Text> : null}
      <Pressable
        style={styles.invoke}
        disabled={controls.isInvoking}
        onPress={() => void controls.invoke(name)}
      >
        <Text style={styles.invokeLabel}>{controls.isInvoking ? "Sending…" : "Invoke"}</Text>
      </Pressable>
    </>
  );
}

function SkillDetail({
  theme,
  frame,
  padding,
  agentId,
  skillId,
  userInvocable,
  onBack,
  onInvoked,
}: {
  theme: Theme;
  frame: SkillBrowserFrame;
  padding: number;
  agentId: string;
  skillId: string;
  userInvocable: boolean;
  onBack: () => void;
  onInvoked: () => void;
}) {
  const callReadSkill = useRpc(readSkill);
  const toast = useToast();
  const controls = useInvoke(agentId, onInvoked);

  const query = useQuery({
    queryKey: ["skill", agentId, skillId],
    queryFn: () => callReadSkill({ agentId, skillId }),
    retry: false,
  });

  const styles = useMemo(() => detailStyles(theme, padding), [theme, padding]);
  const lines = detailLines(frame);

  return (
    <Frame frame={frame} theme={theme} padding={padding}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← All skills</Text>
      </Pressable>
      {query.isPending ? (
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      ) : query.isError ? (
        <Text style={styles.error}>{(query.error as Error).message}</Text>
      ) : (
        <>
          <Text style={styles.name}>{query.data.name}</Text>
          <Text style={styles.description} numberOfLines={lines.description}>
            {query.data.description}
          </Text>
          {/* The popover is for running a skill, not locating it; the tab keeps the path. */}
          {frame === "screen" ? (
            <>
              <Text style={styles.path} selectable>
                {query.data.path}
              </Text>
              <Pressable
                onPress={() => {
                  // The path is `selectable` above, so a platform that denies
                  // programmatic copying still leaves long-press and OS Copy.
                  const path = query.data.path;
                  void copyText(path).then(
                    () => toast.show("Path copied", { variant: "success" }),
                    () => toast.error("Could not copy. Select the path and use Copy."),
                  );
                }}
              >
                <Text style={styles.copy}>Copy path</Text>
              </Pressable>
            </>
          ) : null}
          {userInvocable ? (
            <InvokeControls
              styles={styles}
              theme={theme}
              name={query.data.name}
              controls={controls}
            />
          ) : (
            <Text style={styles.notInvocable}>
              This skill is model-invoked only. The agent can use it, but it cannot be run as a
              command.
            </Text>
          )}
          <Text style={styles.body} numberOfLines={lines.body}>
            {query.data.body}
          </Text>
        </>
      )}
    </Frame>
  );
}

/**
 * Detail for an entry the session reported. There is no `SKILL.md` behind it, so
 * there is no path, no body, and no `skills.read` call — but the description
 * renders in full here rather than clipped to two lines, and the agent can still
 * be asked to run it.
 */
function ReportedDetail({
  theme,
  frame,
  padding,
  agentId,
  entry,
  onBack,
  onInvoked,
}: {
  theme: Theme;
  frame: SkillBrowserFrame;
  padding: number;
  agentId: string;
  entry: ReportedSkill;
  onBack: () => void;
  onInvoked: () => void;
}) {
  const controls = useInvoke(agentId, onInvoked);
  const styles = useMemo(() => detailStyles(theme, padding), [theme, padding]);

  return (
    <Frame frame={frame} theme={theme} padding={padding}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← All skills</Text>
      </Pressable>
      <Text style={styles.name}>{entry.name}</Text>
      {entry.argumentHint ? <Text style={styles.path}>{entry.argumentHint}</Text> : null}
      <Text
        style={[styles.description, { marginTop: 8 }]}
        numberOfLines={detailLines(frame).description}
        selectable
      >
        {entry.description}
      </Text>
      <InvokeControls styles={styles} theme={theme} name={entry.name} controls={controls} />
      <Text style={styles.notInvocable}>
        The agent reported this itself. It has no SKILL.md on disk, so there is nothing further to
        show.
      </Text>
    </Frame>
  );
}

function listStyles(theme: Theme, padding: number) {
  return {
    search: {
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface0,
      borderWidth: 1,
      borderColor: theme.colors.foregroundMuted,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: padding,
    },
    groupLabel: {
      color: theme.colors.foregroundMuted,
      fontSize: 12,
      textTransform: "uppercase" as const,
      marginTop: padding,
      marginBottom: 6,
    },
    row: { paddingVertical: 10 },
    name: { color: theme.colors.foreground, fontSize: 15 },
    hint: { color: theme.colors.foregroundMuted, fontSize: 13, fontFamily: MONO },
    description: { color: theme.colors.foregroundMuted, fontSize: 13, marginTop: 2 },
    groupNote: { color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 6 },
    message: { color: theme.colors.foregroundMuted },
    error: { color: theme.colors.statusDanger },
    groupError: { color: theme.colors.statusDanger, fontSize: 13, marginBottom: 6 },
  };
}

type ListStyles = ReturnType<typeof listStyles>;

/**
 * The list, the search, both detail screens and the invoke — everything the
 * Skills tab shows, drawn by the tab and by the composer pill's popover alike,
 * so a skill run from either is sent the same way.
 *
 * `onInvoked` is what happens after a successful send, and it is the one thing
 * the two callers do differently: the tab moves to the agent's own tab, where
 * the turn it started is, while the popover closes over a composer that is
 * already that agent's.
 */
export function SkillBrowser({
  theme,
  frame,
  padding,
  agentId,
  onInvoked,
}: {
  theme: Theme;
  frame: SkillBrowserFrame;
  padding: number;
  agentId: string;
  onInvoked: () => void;
}) {
  // Only a liveness check — the browser reads everything else off the query,
  // whose own hook is what tracks `cwd`.
  const agentCwd = useAgent(agentId, (snapshot) => snapshot.cwd);
  const [search, setSearch] = useState("");
  // Discovered entries are addressed by their stable id; reported ones have no id
  // and are addressed by name, which the server guarantees is unique across both
  // reported buckets.
  const [selected, setSelected] = useState<Selection | null>(null);

  const query = useSkillsQuery(agentId);

  // The selection is cleared first, so the browser is back on its list when the
  // user returns to it rather than on the detail of a skill already run.
  const handleInvoked = useCallback(
    function handleInvoked() {
      setSelected(null);
      onInvoked();
    },
    [onInvoked],
  );

  const styles = useMemo(() => listStyles(theme, padding), [theme, padding]);

  const term = search.trim().toLowerCase();

  const matches = (skill: { name: string; description: string }) =>
    term.length === 0 ||
    skill.name.toLowerCase().includes(term) ||
    skill.description.toLowerCase().includes(term);

  const filtered = useMemo(
    () => (query.data?.skills ?? []).filter(matches),
    [query.data, term],
  );

  const filteredReportedSkills = useMemo(
    () => (query.data?.reported.skills ?? []).filter(matches),
    [query.data, term],
  );

  const filteredReportedCommands = useMemo(
    () => (query.data?.reported.commands ?? []).filter(matches),
    [query.data, term],
  );

  if (selected?.kind === "discovered") {
    const entry = (query.data?.skills ?? []).find((skill) => skill.id === selected.id);
    return (
      <SkillDetail
        theme={theme}
        frame={frame}
        padding={padding}
        agentId={agentId}
        skillId={selected.id}
        userInvocable={entry?.userInvocable ?? true}
        onBack={() => setSelected(null)}
        onInvoked={handleInvoked}
      />
    );
  }

  if (selected?.kind === "reported") {
    const reportedEntry = [
      ...(query.data?.reported.skills ?? []),
      ...(query.data?.reported.commands ?? []),
    ].find((entry) => entry.name === selected.name);
    // A refetch can drop an entry the session no longer reports. Fall back to the
    // list rather than rendering a detail screen for something that is gone.
    if (!reportedEntry) {
      setSelected(null);
      return null;
    }
    return (
      <ReportedDetail
        theme={theme}
        frame={frame}
        padding={padding}
        agentId={agentId}
        entry={reportedEntry}
        onBack={() => setSelected(null)}
        onInvoked={handleInvoked}
      />
    );
  }

  if (agentCwd == null) {
    return (
      <Frame frame={frame} theme={theme} padding={padding}>
        <Text style={styles.message}>This agent is no longer available.</Text>
      </Frame>
    );
  }

  if (query.isPending) {
    return (
      <Frame frame={frame} theme={theme} padding={padding}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      </Frame>
    );
  }

  if (query.isError) {
    return (
      <Frame frame={frame} theme={theme} padding={padding}>
        <Text style={styles.error}>{(query.error as Error).message}</Text>
      </Frame>
    );
  }

  const reported = query.data?.reported;
  // Every provider reaches this screen. A provider whose skill directories
  // nobody has documented still reports what its session loaded, so the browser
  // renders that and says where it came from rather than refusing outright.
  const scanned = query.data?.scanned ?? false;

  return (
    <Frame frame={frame} theme={theme} padding={padding}>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search skills"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {scanned ? null : (
        <Text style={styles.groupNote}>
          Skill files are only scanned for Claude and Codex. Everything below is what the{" "}
          {query.data?.provider ?? "provider"} session reported.
        </Text>
      )}
      {filtered.length === 0 &&
      filteredReportedSkills.length === 0 &&
      filteredReportedCommands.length === 0 &&
      reported?.error == null ? (
        <Text style={styles.message}>
          {term.length > 0 ? "No skills match that search." : "No skills found."}
        </Text>
      ) : null}
      {groupBySource(filtered).map((group) => (
        <View key={group.label}>
          <Text style={styles.groupLabel}>{group.label}</Text>
          {group.skills.map((skill) => (
            <Pressable
              key={skill.id}
              style={styles.row}
              onPress={() => setSelected({ kind: "discovered", id: skill.id })}
            >
              <Text style={styles.name}>{skill.name}</Text>
              <Text style={styles.description} numberOfLines={2}>
                {skill.description}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
      {reported?.error ? (
        <View>
          <Text style={styles.groupLabel}>Reported by the agent</Text>
          <Text style={styles.groupError}>{reported.error}</Text>
        </View>
      ) : null}
      {filteredReportedSkills.length > 0 ? (
        <ReportedGroup
          styles={styles}
          label="Built-in skills"
          note="Loaded by the running session. These have no SKILL.md to read."
          entries={filteredReportedSkills}
          onSelect={(name) => setSelected({ kind: "reported", name })}
        />
      ) : null}
      {filteredReportedCommands.length > 0 ? (
        <ReportedGroup
          styles={styles}
          label="Built-in commands"
          note="Session controls the agent reported, not skills."
          entries={filteredReportedCommands}
          onSelect={(name) => setSelected({ kind: "reported", name })}
        />
      ) : null}
    </Frame>
  );
}

/**
 * Rows open a reduced detail screen: no path and no body, but the full
 * description and an Invoke button.
 */
function ReportedGroup({
  styles,
  label,
  note,
  entries,
  onSelect,
}: {
  styles: ListStyles;
  label: string;
  note: string;
  entries: ReportedSkill[];
  onSelect: (name: string) => void;
}) {
  return (
    <View>
      <Text style={styles.groupLabel}>{label}</Text>
      <Text style={styles.groupNote}>{note}</Text>
      {entries.map((entry) => (
        <Pressable key={entry.name} style={styles.row} onPress={() => onSelect(entry.name)}>
          <Text style={styles.name}>
            {entry.name}
            {entry.argumentHint ? <Text style={styles.hint}> {entry.argumentHint}</Text> : null}
          </Text>
          <Text style={styles.description} numberOfLines={2}>
            {entry.description}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
