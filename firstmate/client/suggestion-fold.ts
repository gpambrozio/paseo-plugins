/**
 * Whether a suggestion card cuts its text, and what its chevron says. Pure.
 *
 * A folded card cuts its label to one line and its prompt to two. React Native has no portable way to ask
 * a `Text` whether it was cut — `onTextLayout` is missing on the web renderer and reports the whole text
 * rather than the shown lines on iOS — so the card lays the same text out a second time, unclamped and
 * invisible at the same width, and compares the two heights each `onLayout` reports. A height not reported
 * yet counts as cut, so the whole text is one press away until the card knows better.
 */

/** Heights within this many points of each other are the same layout, not a cut line. */
const SAME_HEIGHT = 1;

export function isCut(shown: number | null, whole: number | null): boolean {
  if (shown === null || whole === null) return true;
  return whole > shown + SAME_HEIGHT;
}

/** An open card keeps its chevron, so it can always be folded again. */
export function showsChevron(expanded: boolean, cut: boolean): boolean {
  return expanded || cut;
}

export function chevronLabel(expanded: boolean, label: string): string {
  return `${expanded ? "Hide" : "Show"} the whole suggestion: ${label}`;
}
