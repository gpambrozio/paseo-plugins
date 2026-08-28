import { type PluginAgentPanelProps, useAgent, usePaseo, useRpc } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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

import { listSkills, readSkill, ReportedSkillSchema, SkillEntrySchema } from "./skills.shared";

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

async function copyToClipboard(value: string): Promise<boolean> {
  // React Native dropped Clipboard from core and no clipboard package is
  // available to plugins, so web and desktop copy via the DOM and native falls
  // back to selectable text.
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function detailStyles(theme: PluginAgentPanelProps["theme"], padding: number) {
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding },
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
 */
function useInvoke(agentId: string, onBack: () => void) {
  const paseo = usePaseo();
  const [args, setArgs] = useState("");
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [isInvoking, setIsInvoking] = useState(false);

  async function invoke(name: string) {
    if (isInvoking) return;
    setIsInvoking(true);
    setInvokeError(null);
    const trimmed = args.trim();
    try {
      await paseo.agents.ref(agentId).send(trimmed ? `/${name} ${trimmed}` : `/${name}`);
      onBack();
    } catch (error) {
      setInvokeError(error instanceof Error ? error.message : String(error));
      setIsInvoking(false);
    }
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
  theme: PluginAgentPanelProps["theme"];
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
  layout,
  agentId,
  skillId,
  userInvocable,
  onBack,
}: {
  theme: PluginAgentPanelProps["theme"];
  layout: PluginAgentPanelProps["layout"];
  agentId: string;
  skillId: string;
  userInvocable: boolean;
  onBack: () => void;
}) {
  const callReadSkill = useRpc(readSkill);
  const [copied, setCopied] = useState(false);
  const controls = useInvoke(agentId, onBack);

  const query = useQuery({
    queryKey: ["skill", agentId, skillId],
    queryFn: () => callReadSkill({ agentId, skillId }),
    retry: false,
  });

  const padding = layout.compact ? 12 : 20;
  const styles = useMemo(() => detailStyles(theme, padding), [theme, padding]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
          <Text style={styles.description}>{query.data.description}</Text>
          <Text style={styles.path} selectable>
            {query.data.path}
          </Text>
          <Pressable
            onPress={() => {
              void copyToClipboard(query.data.path).then(setCopied);
            }}
          >
            <Text style={styles.copy}>{copied ? "Copied" : "Copy path"}</Text>
          </Pressable>
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
          <Text style={styles.body}>{query.data.body}</Text>
        </>
      )}
    </ScrollView>
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
  layout,
  agentId,
  entry,
  onBack,
}: {
  theme: PluginAgentPanelProps["theme"];
  layout: PluginAgentPanelProps["layout"];
  agentId: string;
  entry: ReportedSkill;
  onBack: () => void;
}) {
  const controls = useInvoke(agentId, onBack);
  const padding = layout.compact ? 12 : 20;
  const styles = useMemo(() => detailStyles(theme, padding), [theme, padding]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← All skills</Text>
      </Pressable>
      <Text style={styles.name}>{entry.name}</Text>
      {entry.argumentHint ? <Text style={styles.path}>{entry.argumentHint}</Text> : null}
      <Text style={[styles.description, { marginTop: 8 }]} selectable>
        {entry.description}
      </Text>
      <InvokeControls styles={styles} theme={theme} name={entry.name} controls={controls} />
      <Text style={styles.notInvocable}>
        The agent reported this itself. It has no SKILL.md on disk, so there is nothing further to
        show.
      </Text>
    </ScrollView>
  );
}

function listStyles(theme: PluginAgentPanelProps["theme"], padding: number) {
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding },
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

export function SkillsPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const agent = useAgent(agentId, (snapshot) => ({
    provider: snapshot.provider,
    cwd: snapshot.cwd,
  }));
  const callListSkills = useRpc(listSkills);
  const [search, setSearch] = useState("");
  // Discovered entries are addressed by their stable id; reported ones have no id
  // and are addressed by name, which the server guarantees is unique across both
  // reported buckets.
  const [selected, setSelected] = useState<Selection | null>(null);

  const query = useQuery({
    queryKey: ["skills", agentId, agent?.cwd],
    queryFn: () => callListSkills({ agentId }),
    enabled: agent != null,
    retry: false,
  });

  const padding = layout.compact ? 12 : 20;
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
        layout={layout}
        agentId={agentId}
        skillId={selected.id}
        userInvocable={entry?.userInvocable ?? true}
        onBack={() => setSelected(null)}
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
        layout={layout}
        agentId={agentId}
        entry={reportedEntry}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (agent == null) {
    return (
      <View style={[styles.screen, { padding }]}>
        <Text style={styles.message}>This agent is no longer available.</Text>
      </View>
    );
  }

  if (query.isPending) {
    return (
      <View style={[styles.screen, { padding }]}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={[styles.screen, { padding }]}>
        <Text style={styles.error}>{(query.error as Error).message}</Text>
      </View>
    );
  }

  const reported = query.data?.reported;
  // The session's own list stands on its own. A provider discovery cannot scan
  // still reports what it loaded, so "no skill support" is only true when both
  // sources come back empty.
  const hasReported =
    (reported?.skills.length ?? 0) > 0 ||
    (reported?.commands.length ?? 0) > 0 ||
    reported?.error != null;

  if (!query.data?.supported && !hasReported) {
    return (
      <View style={[styles.screen, { padding }]}>
        <Text style={styles.message}>
          {query.data?.provider ?? "This provider"} does not support skills.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search skills"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
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
    </ScrollView>
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
