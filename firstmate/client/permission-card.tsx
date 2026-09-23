/**
 * What an agent is waiting on — the first mate in the chat, a crewmate in the
 * Watch view — answered in the panel.
 *
 * An agent that asks the captain something — Claude's AskUserQuestion — or
 * wants a permission is stopped on a pending permission request, and until
 * this existed the panel said only that it was waiting, so the captain had to
 * open the agent to see what for. A question is drawn as a form, the way the
 * agent's own tab draws it (`questions.ts` holds the rules, ported from
 * Paseo); anything else — a tool to run, a plan to approve — as a card with
 * the request's own buttons, or Allow and Deny when it names none.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Markdown } from "./markdown";
import {
  allAnswered,
  buildAnswers,
  dismissLabel,
  dismissSubmitsEmpty,
  isAnswered,
  parseQuestions,
  showsTextInput,
  toggleOption,
  type OtherTexts,
  type Question,
  type Selections,
} from "./questions";
import { IconButton, MONOSPACE, errorText, type Tone } from "./ui";

type AgentHandle = ReturnType<ReturnType<typeof usePaseo>["agents"]["ref"]>;
export type PermissionRequest = NonNullable<AgentHandle["pendingPermissions"]>[number];
export type PermissionResponse = Parameters<AgentHandle["respondToPermission"]>[0]["response"];

/**
 * An agent's pending requests, and how to answer one as the agent's own tab
 * would. Answered ones are hidden at once rather than when the next timeline
 * read confirms it, so a card cannot be answered twice; a failure is reported
 * and the card comes back.
 */
export function usePendingRequests(
  agentId: string,
  requests: readonly PermissionRequest[] | undefined,
  /** Called as an answer goes out — the transcript follows its end again. */
  onAnswering: () => void,
) {
  const paseo = usePaseo();
  const toast = useToast();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const pending = (requests ?? []).filter((request) => !answered.has(request.id));

  function respond(requestId: string, response: PermissionResponse): Promise<void> {
    onAnswering();
    return paseo.agents
      .ref(agentId)
      .respondToPermission({ requestId, response })
      .then(() => setAnswered((current) => new Set([...current, requestId])))
      .catch((caught: unknown) => {
        toast.error(errorText(caught));
        throw caught;
      });
  }

  return { pending, respond };
}

interface CardProps {
  request: PermissionRequest;
  theme: PluginTheme;
  compact: boolean;
  /** Resolves when the daemon has the answer; the card stays busy until then. */
  onRespond: (response: PermissionResponse) => Promise<void>;
  onOpenLink: (url: string) => void;
}

function useCardStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(() => {
    const { colors } = theme;
    return {
      card: {
        borderWidth: 1,
        borderColor: colors.accent,
        borderRadius: 10,
        backgroundColor: colors.surface1,
        padding: compact ? 10 : 12,
        gap: 10,
      },
      heading: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      headingText: { color: colors.accent, fontSize: 12, fontWeight: "600" as const },
      tabs: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      tab: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
      },
      tabActive: { borderColor: colors.foreground, backgroundColor: colors.surface2 },
      tabText: { color: colors.foregroundMuted, fontSize: 12 },
      tabTextActive: { color: colors.foreground },
      question: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const, lineHeight: 20 },
      option: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 10, paddingVertical: 6 },
      mark: { color: colors.foregroundMuted, fontSize: 16, lineHeight: 20, width: 18 },
      markSelected: { color: colors.accent },
      optionText: { flex: 1, gap: 2 },
      optionLabel: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
      optionDescription: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      input: {
        color: colors.foreground,
        fontSize: 13,
        minHeight: 44,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: colors.surface0,
        textAlignVertical: "top" as const,
      },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      body: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
      code: {
        color: colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 12,
        backgroundColor: colors.surface0,
        borderRadius: 6,
        padding: 8,
      },
    };
  }, [theme, compact]);
}

export function PermissionCard(props: CardProps) {
  const questions = useMemo(
    () => (props.request.kind === "question" ? parseQuestions(props.request.input) : null),
    [props.request],
  );
  return questions === null ? <RequestCard {...props} /> : <QuestionCard {...props} questions={questions} />;
}

function QuestionCard({ request, theme, compact, onRespond, questions }: CardProps & { questions: Question[] }) {
  const styles = useCardStyles(theme, compact);
  const [selections, setSelections] = useState<Selections>({});
  const [otherTexts, setOtherTexts] = useState<OtherTexts>({});
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  const index = Math.min(active, questions.length - 1);
  const question = questions[index];
  const last = index === questions.length - 1;
  const ready = allAnswered(questions, selections, otherTexts);

  function respond(response: PermissionResponse): void {
    setBusy(true);
    // Stays busy on success: the request leaves the list once the daemon has
    // the answer, and this card goes with it.
    onRespond(response).catch(() => setBusy(false));
  }

  function submit(): void {
    if (!ready || busy) return;
    respond({ behavior: "allow", updatedInput: { ...request.input, answers: buildAnswers(questions, selections, otherTexts) } });
  }

  function dismiss(): void {
    if (busy) return;
    if (dismissSubmitsEmpty(questions)) {
      respond({ behavior: "allow", updatedInput: { ...request.input, answers: buildAnswers(questions, selections, otherTexts) } });
      return;
    }
    respond({ behavior: "deny", message: "Dismissed by user" });
  }

  function choose(questionIndex: number, option: number, multiSelect: boolean): void {
    const next = toggleOption(selections[questionIndex], option, multiSelect);
    setSelections({ ...selections, [questionIndex]: next });
    if (otherTexts[questionIndex] !== undefined) {
      const { [questionIndex]: _dropped, ...rest } = otherTexts;
      setOtherTexts(rest);
    }
    // A single choice moves on to the next question, as the agent's tab does.
    if (!multiSelect && next.size > 0 && !last) setActive(questionIndex + 1);
  }

  function type(questionIndex: number, text: string): void {
    setOtherTexts({ ...otherTexts, [questionIndex]: text });
    if (text.length > 0 && (selections[questionIndex]?.size ?? 0) > 0) {
      setSelections({ ...selections, [questionIndex]: new Set<number>() });
    }
  }

  if (question === undefined) return null;
  const selected = selections[index] ?? new Set<number>();
  const answeredHere = isAnswered(question, index, selections, otherTexts);

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Icon name="MessageSquare" size={13} color={theme.colors.accent} />
        <Text style={styles.headingText}>The first mate is asking you</Text>
      </View>

      {questions.length > 1 ? (
        <View style={styles.tabs}>
          {questions.map((entry, entryIndex) => {
            const current = entryIndex === index;
            const done = isAnswered(entry, entryIndex, selections, otherTexts);
            return (
              <Pressable
                key={`${entry.header}-${entryIndex}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: current }}
                style={[styles.tab, current ? styles.tabActive : null]}
                onPress={() => setActive(entryIndex)}
              >
                {done ? <Icon name="Check" size={11} color={theme.colors.statusSuccess} /> : null}
                <Text style={[styles.tabText, current ? styles.tabTextActive : null]}>{entry.header}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.question}>{question.question}</Text>

      {question.options.length === 0 ? null : (
        <View accessibilityRole={question.multiSelect ? undefined : "radiogroup"}>
          {question.options.map((option, optionIndex) => {
            const on = selected.has(optionIndex);
            return (
              <Pressable
                key={`${option.label}-${optionIndex}`}
                accessibilityRole={question.multiSelect ? "checkbox" : "radio"}
                accessibilityState={{ checked: on, disabled: busy }}
                disabled={busy}
                style={styles.option}
                onPress={() => choose(index, optionIndex, question.multiSelect)}
              >
                <Text style={[styles.mark, on ? styles.markSelected : null]}>
                  {question.multiSelect ? (on ? "☑" : "☐") : on ? "◉" : "○"}
                </Text>
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  {option.description === undefined ? null : (
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {showsTextInput(question) ? (
        <TextInput
          key={`other-${index}`}
          value={otherTexts[index] ?? ""}
          onChangeText={(text) => type(index, text)}
          placeholder={question.placeholder ?? (question.options.length > 0 ? "Other…" : "Your answer…")}
          placeholderTextColor={theme.colors.foregroundMuted}
          accessibilityLabel={question.question}
          editable={!busy}
          multiline
          style={styles.input}
        />
      ) : null}

      <View style={styles.actions}>
        <IconButton icon="X" label={dismissLabel(questions)} showLabel theme={theme} disabled={busy} onPress={dismiss} />
        {last ? (
          <IconButton
            icon="Check"
            label={busy ? "Sending…" : "Submit"}
            showLabel
            tone="accent"
            theme={theme}
            disabled={busy || !ready}
            onPress={submit}
          />
        ) : (
          <IconButton
            icon="Check"
            label="Next"
            showLabel
            tone="accent"
            theme={theme}
            disabled={busy || !answeredHere}
            onPress={() => setActive(index + 1)}
          />
        )}
      </View>
    </View>
  );
}

/** A few lines saying what a non-question request wants to do. */
function requestSummary(request: PermissionRequest): { markdown: string | null; code: string | null } {
  const input = (request.input ?? {}) as Record<string, unknown>;
  if (request.kind === "plan" && typeof input.plan === "string") return { markdown: input.plan, code: null };
  const detail = request.detail;
  if (detail?.type === "shell") return { markdown: null, code: `$ ${detail.command}` };
  if (detail?.type === "edit" || detail?.type === "write" || detail?.type === "read") {
    return { markdown: null, code: detail.filePath };
  }
  const text = JSON.stringify(request.input ?? {}, null, 2);
  return { markdown: null, code: text === "{}" ? null : text.length > 600 ? `${text.slice(0, 600)}…` : text };
}

function actionTone(variant: string | undefined, behavior: "allow" | "deny"): Tone {
  if (variant === "danger") return "danger";
  if (variant === "primary" || (variant === undefined && behavior === "allow")) return "accent";
  return "default";
}

function RequestCard({ request, theme, compact, onRespond, onOpenLink }: CardProps) {
  const styles = useCardStyles(theme, compact);
  const [busy, setBusy] = useState(false);
  const summary = useMemo(() => requestSummary(request), [request]);

  function respond(response: PermissionResponse): void {
    setBusy(true);
    onRespond(response).catch(() => setBusy(false));
  }

  const actions =
    request.actions !== undefined && request.actions.length > 0
      ? request.actions.map((action) => ({
          key: action.id,
          label: action.label,
          tone: actionTone(action.variant, action.behavior),
          response: { behavior: action.behavior, selectedActionId: action.id } as PermissionResponse,
        }))
      : [
          { key: "allow", label: "Allow", tone: "accent" as Tone, response: { behavior: "allow" } as PermissionResponse },
          {
            key: "deny",
            label: "Deny",
            tone: "danger" as Tone,
            response: { behavior: "deny", message: "Denied by the captain from the FirstMate panel." } as PermissionResponse,
          },
        ];

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Icon name="AlertTriangle" size={13} color={theme.colors.accent} />
        <Text style={styles.headingText}>
          {request.kind === "plan" ? "The first mate has a plan for you to approve" : "The first mate is asking permission"}
        </Text>
      </View>
      <Text style={styles.question}>{request.title ?? request.name}</Text>
      {request.description === undefined ? null : <Text style={styles.body}>{request.description}</Text>}
      {summary.markdown === null ? null : (
        <Markdown source={summary.markdown} theme={theme} onOpenLink={onOpenLink} />
      )}
      {summary.code === null ? null : (
        <Text selectable style={styles.code} numberOfLines={12}>
          {summary.code}
        </Text>
      )}
      <View style={styles.actions}>
        {actions.map((action) => (
          <IconButton
            key={action.key}
            icon={action.response.behavior === "allow" ? "Check" : "X"}
            label={action.label}
            showLabel
            tone={action.tone}
            theme={theme}
            disabled={busy}
            onPress={() => respond(action.response)}
          />
        ))}
      </View>
    </View>
  );
}
