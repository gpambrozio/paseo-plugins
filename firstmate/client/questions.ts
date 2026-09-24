/**
 * The questions an agent asks (Claude's AskUserQuestion, and the providers
 * that mimic it), as a pending permission of kind `question`.
 *
 * A port of Paseo's own `components/question-form-card-core.ts` (0.9), so the
 * panel answers exactly as the agent's tab would: `allow` with the request's
 * input plus an `answers` map keyed by each question's header, or `deny` with
 * "Dismissed by user". The daemon does the provider-specific part — it adds
 * `allowOther` to Claude's questions on the way out and re-keys the answers
 * by question text on the way back — so nothing here knows about Claude.
 *
 * Pure: the form that draws it is `permission-card.tsx`.
 */

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
  placeholder?: string;
  dismissLabel?: string;
}

/** Selected option indexes, by question index. */
export type Selections = Readonly<Record<number, ReadonlySet<number>>>;
/** Typed answers, by question index. */
export type OtherTexts = Readonly<Record<number, string>>;

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** The request's questions, or null when its input is not a question form. */
export function parseQuestions(input: unknown): Question[] | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = (input as Record<string, unknown>).questions;
  if (!Array.isArray(raw)) return null;
  const questions: Question[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const q = item as Record<string, unknown>;
    if (typeof q.question !== "string" || typeof q.header !== "string" || !Array.isArray(q.options)) return null;
    const options: QuestionOption[] = [];
    for (const option of q.options as unknown[]) {
      if (typeof option !== "object" || option === null) return null;
      const o = option as Record<string, unknown>;
      if (typeof o.label !== "string") return null;
      options.push(typeof o.description === "string" ? { label: o.label, description: o.description } : { label: o.label });
    }
    const placeholder = optionalString(q, "placeholder");
    const dismissLabel = optionalString(q, "dismissLabel");
    questions.push({
      question: q.question,
      header: q.header,
      options,
      multiSelect: q.multiSelect === true,
      allowOther: q.allowOther === true || q.isOther === true,
      allowEmpty: q.allowEmpty === true,
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(dismissLabel === undefined ? {} : { dismissLabel }),
    });
  }
  return questions.length > 0 ? questions : null;
}

export function showsTextInput(question: Question): boolean {
  return question.options.length === 0 || question.allowOther;
}

export function isAnswered(question: Question, index: number, selections: Selections, otherTexts: OtherTexts): boolean {
  if ((selections[index]?.size ?? 0) > 0) return true;
  if (!showsTextInput(question)) return false;
  if ((otherTexts[index]?.trim() ?? "") !== "") return true;
  return question.allowEmpty;
}

export function allAnswered(questions: readonly Question[], selections: Selections, otherTexts: OtherTexts): boolean {
  return questions.every((question, index) => isAnswered(question, index, selections, otherTexts));
}

/** A typed answer wins over a selection; several selections are joined with commas. */
export function buildAnswers(
  questions: readonly Question[],
  selections: Selections,
  otherTexts: OtherTexts,
): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    const typed = otherTexts[index]?.trim() ?? "";
    if (showsTextInput(question)) {
      if (typed !== "") {
        answers[question.header] = typed;
        return;
      }
      if (question.allowEmpty && question.options.length === 0) {
        answers[question.header] = "";
        return;
      }
    }
    const selected = selections[index];
    if (selected !== undefined && selected.size > 0) {
      answers[question.header] = [...selected]
        .map((option) => question.options[option]?.label)
        .filter((label): label is string => label !== undefined)
        .join(", ");
    }
  });
  return answers;
}

/** A form of nothing but optional free-text questions is dismissed by submitting it empty, not by refusing it. */
export function dismissSubmitsEmpty(questions: readonly Question[]): boolean {
  return questions.length > 0 && questions.every((question) => question.allowEmpty && question.options.length === 0);
}

export function dismissLabel(questions: readonly Question[], fallback = "Dismiss"): string {
  return questions.find((question) => question.dismissLabel !== undefined)?.dismissLabel ?? fallback;
}

/**
 * The next selection after pressing an option: toggled in a multi-select,
 * otherwise the one option (or none, pressing it again).
 */
export function toggleOption(current: ReadonlySet<number> | undefined, option: number, multiSelect: boolean): Set<number> {
  const next = new Set(current ?? []);
  if (multiSelect) {
    if (!next.delete(option)) next.add(option);
    return next;
  }
  const wasSelected = next.has(option);
  next.clear();
  if (!wasSelected) next.add(option);
  return next;
}
