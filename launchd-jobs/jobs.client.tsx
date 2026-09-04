import { Icon, type PluginSurfaceProps, useRpc } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { describeCron, describeInterval, entryCount, parseCron } from "./cron";
import type { Job, JobSpec, RunRecord } from "./jobs.shared";
import { createJob, deleteJob, listJobs, readJobLog, runJob, setJobEnabled, updateJob } from "./jobs.shared";

/**
 * The surface: a list of the plugin's LaunchAgents on the left, and on the
 * right whichever of three things is open — a job's detail, the form editing
 * it, or the form for a new one. Compact shows one pane at a time.
 *
 * Async **function expressions**, never async arrows, anywhere in this file:
 * the app `eval`s the client bundle, and Hermes's eval compiler on iOS and
 * Android evaluates an async arrow to `undefined` instead of a function.
 * Desktop runs on V8 and never sees it. Same reason every closure over a
 * list element goes through `.map`, never a `for…of` body.
 */

/**
 * Module-scope caches, because the surface is unmounted whenever the user
 * navigates to a workspace and mounted fresh on the way back. The list
 * repaints before the first load answers; the open pane comes back; and a
 * half-typed form is still there, keyed by what it was editing so a draft for
 * one job is never adopted by another.
 */
let cachedJobs: Job[] | null = null;
let cachedPane: Pane = { kind: "empty" };
let cachedDraft: { key: string; draft: Draft } | null = null;

/** How often the list re-asks launchd while the surface is on screen. */
const REFRESH_MS = 15_000;

type Pane = { kind: "empty" } | { kind: "view"; id: string } | { kind: "edit"; id: string } | { kind: "new" };

interface Notice {
  tone: "info" | "danger";
  text: string;
}

function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color;
}

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return iso;
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function absoluteTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

type Tone = "muted" | "accent" | "danger";

/**
 * One word for the row. Precedence: a plist that could not be read, then
 * what launchd says about the label, then the last run the runner recorded,
 * then launchd's own exit code for a plist that predates the runner.
 */
function statusOf(job: Job): { label: string; tone: Tone } {
  if (job.problem !== null) return { label: "Unreadable", tone: "danger" };
  if (job.disabled) return { label: "Disabled", tone: "muted" };
  if (!job.loaded) return { label: "Not loaded", tone: "danger" };
  if (job.running) return { label: "Running", tone: "accent" };
  const last = job.recentRuns[0];
  const exit = last === undefined ? job.lastExitCode : last.exitCode;
  if (exit !== null && exit !== 0) return { label: `Failed (exit ${exit})`, tone: "danger" };
  if (exit === null) return { label: "Never run", tone: "muted" };
  return { label: "OK", tone: "muted" };
}

// ---------------------------------------------------------------------------
// Styles

function useStyles({ theme, layout }: PluginSurfaceProps) {
  return useMemo(() => {
    const { colors } = theme;
    const separator = withAlpha(colors.foregroundMuted, "33");
    const faint = withAlpha(colors.foregroundMuted, "14");
    const pad = layout.compact ? 12 : 16;
    const mono = { fontFamily: layout.platform === "ios" ? "Menlo" : "monospace" } as const;
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: pad,
        paddingVertical: layout.compact ? 10 : 12,
        borderBottomWidth: 1,
        borderBottomColor: separator,
      },
      title: { color: colors.foreground, fontSize: layout.compact ? 17 : 19, fontWeight: "600" as const },
      spacer: { flex: 1 },
      body: { flex: 1, flexDirection: "row" as const },
      list: {
        width: layout.compact ? undefined : 320,
        flex: layout.compact ? 1 : undefined,
        borderRightWidth: layout.compact ? 0 : 1,
        borderRightColor: separator,
      },
      pane: { flex: 1 },
      paneContent: { padding: pad, gap: 14 },
      row: {
        paddingHorizontal: pad,
        paddingVertical: 10,
        gap: 3,
        borderBottomWidth: 1,
        borderBottomColor: separator,
      },
      rowSelected: { backgroundColor: faint },
      rowPressed: { opacity: 0.7 },
      rowTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      rowName: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const, flex: 1 },
      rowLine: { color: colors.foregroundMuted, fontSize: 12 },
      pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
      pillText: { fontSize: 11, fontWeight: "600" as const },
      pillMuted: { borderColor: separator },
      pillAccent: { borderColor: colors.accent },
      pillDanger: { borderColor: colors.statusDanger },
      textMuted: { color: colors.foregroundMuted },
      textAccent: { color: colors.accent },
      textDanger: { color: colors.statusDanger },
      textBody: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
      heading: { color: colors.foreground, fontSize: 18, fontWeight: "600" as const },
      sectionTitle: {
        color: colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        textTransform: "uppercase" as const,
        letterSpacing: 0.6,
      },
      label: { color: colors.foregroundMuted, fontSize: 12, marginBottom: 4 },
      code: {
        ...mono,
        color: colors.foreground,
        fontSize: 12,
        lineHeight: 17,
        backgroundColor: faint,
        borderRadius: 6,
        padding: 10,
      },
      logBox: { backgroundColor: faint, borderRadius: 6, maxHeight: layout.compact ? 260 : 360 },
      logText: { ...mono, color: colors.foreground, fontSize: 11, lineHeight: 15, padding: 10 },
      input: {
        color: colors.foreground,
        borderWidth: 1,
        borderColor: separator,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 13,
      },
      inputMono: { ...mono, minHeight: 72, textAlignVertical: "top" as const },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, alignItems: "center" as const },
      button: { backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7 },
      buttonLabel: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
      ghostButton: { borderWidth: 1, borderColor: separator, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7 },
      ghostButtonLabel: { color: colors.foreground, fontSize: 13 },
      dangerButton: { borderWidth: 1, borderColor: colors.statusDanger, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7 },
      dangerButtonLabel: { color: colors.statusDanger, fontSize: 13, fontWeight: "600" as const },
      iconButton: { padding: 6, borderRadius: 6 },
      chip: { borderWidth: 1, borderColor: separator, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
      chipOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, "22") },
      chipText: { color: colors.foreground, fontSize: 12 },
      disabled: { opacity: 0.5 },
      notice: { marginHorizontal: pad, marginTop: 10, padding: 10, borderRadius: 6, borderWidth: 1 },
      noticeInfo: { borderColor: colors.accent },
      noticeDanger: { borderColor: colors.statusDanger },
      noticeText: { color: colors.foreground, fontSize: 13 },
      empty: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: 24, gap: 8 },
      emptyText: { color: colors.foregroundMuted, fontSize: 13, textAlign: "center" as const, maxWidth: 420 },
      runRow: { flexDirection: "row" as const, gap: 10, alignItems: "baseline" as const, paddingVertical: 3 },
      runTime: { color: colors.foreground, fontSize: 12, flex: 1 },
      runMeta: { color: colors.foregroundMuted, fontSize: 12 },
      facts: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 14 },
      fact: { gap: 2 },
      factValue: { color: colors.foreground, fontSize: 13 },
    };
  }, [theme, layout.compact, layout.platform]);
}

type Styles = ReturnType<typeof useStyles>;

// ---------------------------------------------------------------------------
// Small pieces

function Pill({ styles, label, tone }: { styles: Styles; label: string; tone: Tone }) {
  const frame = tone === "danger" ? styles.pillDanger : tone === "accent" ? styles.pillAccent : styles.pillMuted;
  const text = tone === "danger" ? styles.textDanger : tone === "accent" ? styles.textAccent : styles.textMuted;
  return (
    <View style={[styles.pill, frame]}>
      <Text style={[styles.pillText, text]}>{label}</Text>
    </View>
  );
}

function Button({
  styles,
  label,
  onPress,
  kind = "primary",
  disabled = false,
}: {
  styles: Styles;
  label: string;
  onPress: () => void;
  kind?: "primary" | "ghost" | "danger";
  disabled?: boolean;
}) {
  const frame = kind === "primary" ? styles.button : kind === "ghost" ? styles.ghostButton : styles.dangerButton;
  const text =
    kind === "primary" ? styles.buttonLabel : kind === "ghost" ? styles.ghostButtonLabel : styles.dangerButtonLabel;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [frame, disabled ? styles.disabled : null, pressed ? styles.rowPressed : null]}
    >
      <Text style={text}>{label}</Text>
    </Pressable>
  );
}

function Chip({ styles, label, on, onPress }: { styles: Styles; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, on ? styles.chipOn : null]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

function Section({ styles, title, children }: { styles: Styles; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The list

function JobRow({
  styles,
  job,
  selected,
  onPress,
}: {
  styles: Styles;
  job: Job;
  selected: boolean;
  onPress: () => void;
}) {
  const status = statusOf(job);
  const last = job.recentRuns[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.name}, ${status.label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected ? styles.rowSelected : null, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.rowName} numberOfLines={1}>
          {job.name}
        </Text>
        <Pill styles={styles} label={status.label} tone={status.tone} />
      </View>
      <Text style={styles.rowLine} numberOfLines={1}>
        {job.schedule.description}
      </Text>
      {last !== undefined ? (
        <Text style={styles.rowLine} numberOfLines={1}>
          Last run {relativeTime(last.finishedAt)} · {duration(last.durationMs)}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// The detail pane

function RunLine({ styles, run }: { styles: Styles; run: RunRecord }) {
  return (
    <View style={styles.runRow}>
      <Text style={styles.runTime}>{absoluteTime(run.startedAt)}</Text>
      <Text style={styles.runMeta}>{duration(run.durationMs)}</Text>
      <Text style={[styles.runMeta, run.exitCode === 0 ? null : styles.textDanger]}>
        {run.exitCode === 0 ? "exit 0" : `exit ${run.exitCode}`}
      </Text>
    </View>
  );
}

function JobDetail({
  styles,
  job,
  compact,
  foreground,
  onBack,
  onEdit,
  onChanged,
  onDeleted,
  onNotice,
}: {
  styles: Styles;
  job: Job;
  compact: boolean;
  foreground: string;
  onBack: () => void;
  onEdit: () => void;
  onChanged: (job: Job) => void;
  onDeleted: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const run = useRpc(runJob);
  const setEnabled = useRpc(setJobEnabled);
  const remove = useRpc(deleteJob);
  const readLog = useRpc(readJobLog);
  const [working, setWorking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [log, setLog] = useState<{ text: string; truncated: boolean; path: string } | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const status = statusOf(job);

  const loadLog = useCallback(
    async function loadLog() {
      setLogBusy(true);
      try {
        setLog(await readLog({ id: job.id }));
      } catch (error) {
        onNotice({ tone: "danger", text: `Could not read the log: ${errorText(error)}` });
      } finally {
        setLogBusy(false);
      }
    },
    [job.id, readLog, onNotice],
  );

  // A fresh job, or a run that just finished, is the moment to look again.
  const lastFinished = job.recentRuns[0]?.finishedAt ?? null;
  useEffect(() => {
    void loadLog();
  }, [loadLog, lastFinished]);

  useEffect(() => setConfirmDelete(false), [job.id]);

  const act = useCallback(
    async function act(work: () => Promise<void>, failure: string) {
      setWorking(true);
      try {
        await work();
      } catch (error) {
        onNotice({ tone: "danger", text: `${failure}: ${errorText(error)}` });
      } finally {
        setWorking(false);
      }
    },
    [onNotice],
  );

  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.paneContent}>
      <View style={styles.rowTop}>
        {compact ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to the list" onPress={onBack} style={styles.iconButton}>
            <Icon name="ArrowLeft" size={18} color={foreground} />
          </Pressable>
        ) : null}
        <Text style={[styles.heading, { flex: 1 }]}>{job.name}</Text>
        <Pill styles={styles} label={status.label} tone={status.tone} />
      </View>

      {job.problem !== null ? <Text style={[styles.textBody, styles.textDanger]}>{job.problem}</Text> : null}
      {!job.managed && job.problem === null ? (
        <Text style={[styles.textBody, styles.textMuted]}>
          This plist was not written by the plugin. It is shown as launchd runs it; saving an edit rewrites it in the
          plugin's shape.
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          styles={styles}
          label="Run now"
          disabled={working || !job.loaded}
          onPress={() =>
            void act(async function runNow() {
              await run({ id: job.id });
              onNotice({ tone: "info", text: `Asked launchd to start "${job.name}".` });
            }, "Could not start the job")
          }
        />
        <Button
          styles={styles}
          kind="ghost"
          label={job.disabled || !job.loaded ? "Enable" : "Disable"}
          disabled={working}
          onPress={() =>
            void act(async function toggle() {
              onChanged(await setEnabled({ id: job.id, enabled: job.disabled || !job.loaded }));
            }, "Could not change the job")
          }
        />
        <Button styles={styles} kind="ghost" label="Edit" disabled={working} onPress={onEdit} />
        {confirmDelete ? (
          <>
            <Button
              styles={styles}
              kind="danger"
              label="Confirm delete"
              disabled={working}
              onPress={() =>
                void act(async function destroy() {
                  await remove({ id: job.id });
                  onDeleted();
                }, "Could not delete the job")
              }
            />
            <Button styles={styles} kind="ghost" label="Keep" onPress={() => setConfirmDelete(false)} />
          </>
        ) : (
          <Button styles={styles} kind="danger" label="Delete" disabled={working} onPress={() => setConfirmDelete(true)} />
        )}
        {working ? <ActivityIndicator size="small" color={foreground} /> : null}
      </View>

      <Section styles={styles} title="Schedule">
        <Text style={styles.textBody}>{job.schedule.description}</Text>
        {job.schedule.type === "cron" ? (
          <Text style={[styles.textBody, styles.textMuted]}>
            {job.schedule.expression} · {job.schedule.entries.length} launchd{" "}
            {job.schedule.entries.length === 1 ? "entry" : "entries"}
          </Text>
        ) : null}
      </Section>

      <Section styles={styles} title="Command">
        <Text style={styles.code} selectable>
          {job.command === "" ? "(none)" : job.command}
        </Text>
      </Section>

      <View style={styles.facts}>
        <View style={styles.fact}>
          <Text style={styles.label}>Working directory</Text>
          <Text style={styles.factValue}>{job.cwd ?? "Home directory"}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.label}>Runs since load</Text>
          <Text style={styles.factValue}>{job.runs ?? "—"}</Text>
        </View>
        {job.pid !== null ? (
          <View style={styles.fact}>
            <Text style={styles.label}>PID</Text>
            <Text style={styles.factValue}>{job.pid}</Text>
          </View>
        ) : null}
      </View>

      <Section styles={styles} title="Recent runs">
        {job.recentRuns.length === 0 ? (
          <Text style={[styles.textBody, styles.textMuted]}>Nothing recorded yet.</Text>
        ) : (
          job.recentRuns.map((entry) => <RunLine key={entry.startedAt + entry.finishedAt} styles={styles} run={entry} />)
        )}
      </Section>

      <Section styles={styles} title="Log">
        <View style={styles.actions}>
          <Button styles={styles} kind="ghost" label={logBusy ? "Loading…" : "Refresh log"} disabled={logBusy} onPress={() => void loadLog()} />
          {log?.truncated ? <Text style={[styles.textBody, styles.textMuted]}>Showing the last 64 KB.</Text> : null}
        </View>
        <ScrollView style={styles.logBox} nestedScrollEnabled>
          <Text style={styles.logText} selectable>
            {log === null ? "" : log.text === "" ? "No output yet." : log.text}
          </Text>
        </ScrollView>
        <Text style={[styles.rowLine, styles.textMuted]} selectable>
          {job.logPath}
        </Text>
        <Text style={[styles.rowLine, styles.textMuted]} selectable>
          {job.plistPath}
        </Text>
      </Section>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// The form

type IntervalUnit = "seconds" | "minutes" | "hours";

const UNIT_SECONDS: Record<IntervalUnit, number> = { seconds: 1, minutes: 60, hours: 3600 };

interface Draft {
  name: string;
  command: string;
  cwd: string;
  mode: "cron" | "interval";
  expression: string;
  every: string;
  unit: IntervalUnit;
}

function draftFrom(job: Job | null): Draft {
  const base: Draft = { name: "", command: "", cwd: "", mode: "cron", expression: "0 9 * * 1-5", every: "30", unit: "minutes" };
  if (job === null) return base;
  const draft: Draft = { ...base, name: job.name, command: job.command, cwd: job.cwd ?? "" };
  if (job.schedule.type === "cron") draft.expression = job.schedule.expression;
  if (job.schedule.type === "interval") {
    draft.mode = "interval";
    const { seconds } = job.schedule;
    const unit: IntervalUnit = seconds % 3600 === 0 ? "hours" : seconds % 60 === 0 ? "minutes" : "seconds";
    draft.unit = unit;
    draft.every = String(seconds / UNIT_SECONDS[unit]);
  }
  return draft;
}

/** The spec the draft describes, or the first thing wrong with it. */
function specFrom(draft: Draft): { ok: true; spec: JobSpec } | { ok: false; error: string } {
  const name = draft.name.trim();
  if (name === "") return { ok: false, error: "Give the job a name" };
  const command = draft.command.trim();
  if (command === "") return { ok: false, error: "Give the job a command" };
  const cwd = draft.cwd.trim();
  let schedule: JobSpec["schedule"];
  if (draft.mode === "cron") {
    const parsed = parseCron(draft.expression);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    schedule = { type: "cron", expression: draft.expression.trim() };
  } else {
    const every = Number(draft.every);
    if (!Number.isFinite(every) || every <= 0) return { ok: false, error: "The interval must be a positive number" };
    const seconds = Math.round(every * UNIT_SECONDS[draft.unit]);
    if (seconds < 1) return { ok: false, error: "The interval must be at least a second" };
    schedule = { type: "interval", seconds };
  }
  return { ok: true, spec: { name, command, cwd: cwd === "" ? null : cwd, schedule } };
}

function JobForm({
  styles,
  job,
  compact,
  foreground,
  muted,
  onCancel,
  onSaved,
}: {
  styles: Styles;
  job: Job | null;
  compact: boolean;
  foreground: string;
  muted: string;
  onCancel: () => void;
  onSaved: (job: Job) => void;
}) {
  const create = useRpc(createJob);
  const update = useRpc(updateJob);
  const draftKey = job === null ? "new" : `edit-${job.id}`;
  const [draft, setDraft] = useState<Draft>(() =>
    cachedDraft?.key === draftKey ? cachedDraft.draft : draftFrom(job),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(
    (change: Partial<Draft>) =>
      setDraft((current) => {
        const next = { ...current, ...change };
        cachedDraft = { key: draftKey, draft: next };
        return next;
      }),
    [draftKey],
  );

  // Leaving on purpose, by either button, is what forgets the draft; a
  // navigation away is not.
  const cancel = useCallback(() => {
    cachedDraft = null;
    onCancel();
  }, [onCancel]);

  // What launchd will be told, updated as the expression is typed.
  const preview = useMemo(() => {
    if (draft.mode === "interval") {
      const every = Number(draft.every);
      if (!Number.isFinite(every) || every <= 0) return { ok: false as const, text: "Enter a positive number" };
      return { ok: true as const, text: describeInterval(Math.round(every * UNIT_SECONDS[draft.unit])) };
    }
    const parsed = parseCron(draft.expression);
    if (!parsed.ok) return { ok: false as const, text: parsed.error };
    const count = entryCount(parsed.fields);
    const suffix = count === 1 ? "" : ` · ${count} launchd entries`;
    return { ok: true as const, text: `${describeCron(parsed.fields)}${suffix}` };
  }, [draft.mode, draft.every, draft.unit, draft.expression]);

  const save = useCallback(
    async function save() {
      const result = specFrom(draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const saved = job === null ? await create(result.spec) : await update({ id: job.id, spec: result.spec });
        cachedDraft = null;
        onSaved(saved);
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        setSaving(false);
      }
    },
    [draft, job, create, update, onSaved],
  );

  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.paneContent} keyboardShouldPersistTaps="handled">
      <View style={styles.rowTop}>
        {compact ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={cancel} style={styles.iconButton}>
            <Icon name="ArrowLeft" size={18} color={foreground} />
          </Pressable>
        ) : null}
        <Text style={[styles.heading, { flex: 1 }]}>{job === null ? "New job" : `Edit ${job.name}`}</Text>
      </View>

      <View>
        <Text style={styles.label}>Name</Text>
        <TextInput
          accessibilityLabel="Job name"
          style={styles.input}
          value={draft.name}
          onChangeText={(name) => patch({ name })}
          placeholder="Nightly backup"
          placeholderTextColor={muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View>
        <Text style={styles.label}>Command — run by /bin/zsh -lc, with your login shell's PATH</Text>
        <TextInput
          accessibilityLabel="Command"
          style={[styles.input, styles.inputMono]}
          value={draft.command}
          onChangeText={(command) => patch({ command })}
          placeholder="rsync -a ~/Documents /Volumes/Backup/"
          placeholderTextColor={muted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View>
        <Text style={styles.label}>Working directory — optional, absolute or ~/…</Text>
        <TextInput
          accessibilityLabel="Working directory"
          style={styles.input}
          value={draft.cwd}
          onChangeText={(cwd) => patch({ cwd })}
          placeholder="~/repositories/project"
          placeholderTextColor={muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Schedule</Text>
        <View style={styles.actions}>
          <Chip styles={styles} label="Cron expression" on={draft.mode === "cron"} onPress={() => patch({ mode: "cron" })} />
          <Chip styles={styles} label="Fixed interval" on={draft.mode === "interval"} onPress={() => patch({ mode: "interval" })} />
        </View>
        {draft.mode === "cron" ? (
          <TextInput
            accessibilityLabel="Cron expression"
            style={[styles.input, { fontFamily: styles.code.fontFamily }]}
            value={draft.expression}
            onChangeText={(expression) => patch({ expression })}
            placeholder="minute hour day month weekday"
            placeholderTextColor={muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : (
          <View style={styles.actions}>
            <Text style={styles.textBody}>Every</Text>
            <TextInput
              accessibilityLabel="Interval"
              style={[styles.input, { width: 80 }]}
              value={draft.every}
              onChangeText={(every) => patch({ every })}
              keyboardType="numeric"
            />
            {(["seconds", "minutes", "hours"] as const).map((unit) => (
              <Chip key={unit} styles={styles} label={unit} on={draft.unit === unit} onPress={() => patch({ unit })} />
            ))}
          </View>
        )}
        <Text style={[styles.textBody, preview.ok ? styles.textMuted : styles.textDanger]}>{preview.text}</Text>
      </View>

      {error !== null ? <Text style={[styles.textBody, styles.textDanger]}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button styles={styles} label={saving ? "Saving…" : job === null ? "Create job" : "Save changes"} disabled={saving} onPress={() => void save()} />
        <Button styles={styles} kind="ghost" label="Cancel" disabled={saving} onPress={cancel} />
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// The surface

export function LaunchdJobs(props: PluginSurfaceProps) {
  const styles = useStyles(props);
  const { compact } = props.layout;
  const foreground = props.theme.colors.foreground;
  const muted = props.theme.colors.foregroundMuted;
  const list = useRpc(listJobs);

  const [jobs, setJobs] = useState<Job[] | null>(cachedJobs);
  const [supported, setSupported] = useState(true);
  const [launchAgentsDir, setLaunchAgentsDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(cachedJobs === null);
  const [pane, setPaneState] = useState<Pane>(cachedPane);
  const setPane = useCallback((next: Pane) => {
    cachedPane = next;
    setPaneState(next);
  }, []);
  const [notice, setNotice] = useState<Notice | null>(null);
  const paneRef = useRef(pane);
  paneRef.current = pane;

  const refresh = useCallback(
    async function refresh(quiet = false) {
      if (!quiet) setBusy(true);
      try {
        const next = await list({});
        cachedJobs = next.jobs;
        setJobs(next.jobs);
        setSupported(next.supported);
        setLaunchAgentsDir(next.launchAgentsDir);
        setError(null);
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        if (!quiet) setBusy(false);
      }
    },
    [list],
  );

  useEffect(() => {
    void refresh();
    // While a form is open the list still refreshes underneath, which is
    // harmless: the form owns its own draft.
    const timer = setInterval(() => void refresh(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const replaceJob = useCallback((job: Job) => {
    setJobs((current) => {
      const rest = (current ?? []).filter((entry) => entry.id !== job.id);
      const next = [...rest, job].sort((a, b) => a.id.localeCompare(b.id));
      cachedJobs = next;
      return next;
    });
  }, []);

  const showNotice = useCallback((next: Notice) => setNotice(next), []);

  const selectedId = pane.kind === "view" || pane.kind === "edit" ? pane.id : null;
  const selected = selectedId === null ? null : (jobs ?? []).find((job) => job.id === selectedId) ?? null;

  // A job deleted elsewhere, or a broken refresh, must not strand the pane.
  useEffect(() => {
    if (selectedId !== null && jobs !== null && selected === null) setPane({ kind: "empty" });
  }, [selectedId, selected, jobs]);

  const showList = !compact || pane.kind === "empty";
  const showPane = !compact || pane.kind !== "empty";

  let paneView: React.ReactNode = null;
  if (pane.kind === "new") {
    paneView = (
      <JobForm
        key="new"
        styles={styles}
        job={null}
        compact={compact}
        foreground={foreground}
        muted={muted}
        onCancel={() => setPane({ kind: "empty" })}
        onSaved={(job) => {
          replaceJob(job);
          setPane({ kind: "view", id: job.id });
          setNotice({ tone: "info", text: `Created "${job.name}" and loaded it into launchd.` });
        }}
      />
    );
  } else if (pane.kind === "edit" && selected !== null) {
    paneView = (
      <JobForm
        key={`edit-${selected.id}`}
        styles={styles}
        job={selected}
        compact={compact}
        foreground={foreground}
        muted={muted}
        onCancel={() => setPane({ kind: "view", id: selected.id })}
        onSaved={(job) => {
          replaceJob(job);
          setPane({ kind: "view", id: job.id });
          setNotice({ tone: "info", text: `Saved "${job.name}" and reloaded it in launchd.` });
        }}
      />
    );
  } else if (pane.kind === "view" && selected !== null) {
    paneView = (
      <JobDetail
        key={selected.id}
        styles={styles}
        job={selected}
        compact={compact}
        foreground={foreground}
        onBack={() => setPane({ kind: "empty" })}
        onEdit={() => setPane({ kind: "edit", id: selected.id })}
        onChanged={replaceJob}
        onDeleted={() => {
          setJobs((current) => {
            const next = (current ?? []).filter((entry) => entry.id !== selected.id);
            cachedJobs = next;
            return next;
          });
          setPane({ kind: "empty" });
          setNotice({ tone: "info", text: `Deleted "${selected.name}".` });
        }}
        onNotice={showNotice}
      />
    );
  } else if (!compact) {
    paneView = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Select a job, or create one.</Text>
      </View>
    );
  }

  if (!supported) {
    return (
      <View style={styles.screen}>
        <View style={styles.empty}>
          <Text style={styles.heading}>macOS only</Text>
          <Text style={styles.emptyText}>
            This plugin manages launchd agents, and the daemon this surface is connected to is not running on macOS.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Scheduled jobs</Text>
        <View style={styles.spacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? "Loading" : "Refresh"}
          disabled={busy}
          onPress={() => void refresh()}
          style={styles.iconButton}
        >
          {busy ? <ActivityIndicator size="small" color={muted} /> : <Icon name="RefreshCw" size={15} color={foreground} />}
        </Pressable>
        <Button styles={styles} label="New job" onPress={() => setPane({ kind: "new" })} />
      </View>

      {notice !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={() => setNotice(null)}
          style={[styles.notice, notice.tone === "danger" ? styles.noticeDanger : styles.noticeInfo]}
        >
          <Text style={styles.noticeText}>{notice.text}</Text>
        </Pressable>
      ) : null}
      {error !== null ? (
        <View style={[styles.notice, styles.noticeDanger]}>
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.body}>
        {showList ? (
          <ScrollView style={styles.list}>
            {jobs === null ? null : jobs.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  No jobs yet. Anything created here becomes a LaunchAgent
                  {launchAgentsDir === null ? "" : ` in ${launchAgentsDir}`}, and runs whether or not Paseo is open.
                </Text>
              </View>
            ) : (
              jobs.map((job) => (
                <JobRow
                  key={job.id}
                  styles={styles}
                  job={job}
                  selected={job.id === selectedId}
                  onPress={() => setPane({ kind: "view", id: job.id })}
                />
              ))
            )}
          </ScrollView>
        ) : null}
        {showPane ? paneView : null}
      </View>
    </View>
  );
}
