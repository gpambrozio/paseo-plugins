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

import { listSkills, readSkill, SkillEntrySchema } from "./skills.shared";

type Skill = z.infer<typeof SkillEntrySchema>;

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
  const paseo = usePaseo();
  const [args, setArgs] = useState("");
  const [copied, setCopied] = useState(false);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [isInvoking, setIsInvoking] = useState(false);

  const query = useQuery({
    queryKey: ["skill", agentId, skillId],
    queryFn: () => callReadSkill({ agentId, skillId }),
    retry: false,
  });

  const padding = layout.compact ? 12 : 20;
  const styles = useMemo(
    () => ({
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
    }),
    [theme, padding],
  );

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
            <>
              <TextInput
                style={styles.argsInput}
                value={args}
                onChangeText={setArgs}
                placeholder="Arguments (optional)"
                placeholderTextColor={theme.colors.foregroundMuted}
                autoCorrect={false}
              />
              {invokeError ? <Text style={styles.error}>{invokeError}</Text> : null}
              <Pressable
                style={styles.invoke}
                disabled={isInvoking}
                onPress={() => void invoke(query.data.name)}
              >
                <Text style={styles.invokeLabel}>{isInvoking ? "Sending…" : "Invoke"}</Text>
              </Pressable>
            </>
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

export function SkillsPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const agent = useAgent(agentId, (snapshot) => ({
    provider: snapshot.provider,
    cwd: snapshot.cwd,
  }));
  const callListSkills = useRpc(listSkills);
  const [search, setSearch] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["skills", agentId, agent?.cwd],
    queryFn: () => callListSkills({ agentId }),
    enabled: agent != null,
    retry: false,
  });

  const padding = layout.compact ? 12 : 20;
  const styles = useMemo(
    () => ({
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
      description: { color: theme.colors.foregroundMuted, fontSize: 13, marginTop: 2 },
      message: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
    }),
    [theme, padding],
  );

  const filtered = useMemo(() => {
    const skills = query.data?.skills ?? [];
    const term = search.trim().toLowerCase();
    if (term.length === 0) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(term) ||
        skill.description.toLowerCase().includes(term),
    );
  }, [query.data, search]);

  if (selectedSkillId) {
    const selected = (query.data?.skills ?? []).find((skill) => skill.id === selectedSkillId);
    return (
      <SkillDetail
        theme={theme}
        layout={layout}
        agentId={agentId}
        skillId={selectedSkillId}
        userInvocable={selected?.userInvocable ?? true}
        onBack={() => setSelectedSkillId(null)}
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

  if (!query.data?.supported) {
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
      {filtered.length === 0 ? (
        <Text style={styles.message}>
          {search.trim().length > 0 ? "No skills match that search." : "No skills found."}
        </Text>
      ) : (
        groupBySource(filtered).map((group) => (
          <View key={group.label}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {group.skills.map((skill) => (
              <Pressable
                key={skill.id}
                style={styles.row}
                onPress={() => setSelectedSkillId(skill.id)}
              >
                <Text style={styles.name}>{skill.name}</Text>
                <Text style={styles.description} numberOfLines={2}>
                  {skill.description}
                </Text>
              </Pressable>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}
