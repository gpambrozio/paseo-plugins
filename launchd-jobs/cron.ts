/**
 * Cron expressions to and from launchd's `StartCalendarInterval`.
 *
 * Unsuffixed on purpose: this file lands in both bundles and must stay free of
 * Node imports. The surface uses it to preview a schedule while it is typed;
 * the server uses it to build the plist and to read one back.
 *
 * launchd has no expression language. A calendar interval is a dictionary of
 * `Minute`, `Hour`, `Day`, `Month`, `Weekday`, each a single number, and a
 * job may carry an array of them. So a cron field with several values becomes
 * several dictionaries — the cartesian product of every restricted field —
 * and an expression like `0,30 9-17 * * 1-5` is 2 × 9 × 5 = 90 entries.
 * `MAX_ENTRIES` keeps a careless step from producing thousands.
 *
 * One semantic difference is deliberate and documented in the README: cron
 * fires when *either* day-of-month or weekday matches when both are
 * restricted, launchd only when both do.
 */

export interface CalendarEntry {
  minute?: number;
  hour?: number;
  day?: number;
  month?: number;
  weekday?: number;
}

export const CALENDAR_FIELDS = ["minute", "hour", "day", "month", "weekday"] as const;
export type CalendarField = (typeof CALENDAR_FIELDS)[number];

/** A parsed expression: per field, every value it allows, or null for `*`. */
export type CronFields = Record<CalendarField, number[] | null>;

export type CronResult = { ok: true; fields: CronFields } | { ok: false; error: string };

export const MAX_ENTRIES = 1000;

interface FieldSpec {
  min: number;
  max: number;
  names?: readonly string[];
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const FIELD_SPECS: Record<CalendarField, FieldSpec> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: { min: 1, max: 12, names: MONTH_NAMES },
  // 7 is accepted as Sunday on the way in and folded to 0 below.
  weekday: { min: 0, max: 7, names: WEEKDAY_NAMES },
};

function parseNumber(token: string, spec: FieldSpec, field: CalendarField): number | string {
  const lowered = token.toLowerCase();
  const named = spec.names?.indexOf(lowered) ?? -1;
  if (named >= 0) return named + spec.min;
  if (!/^\d+$/.test(token)) return `"${token}" is not a valid ${field}`;
  const value = Number(token);
  if (value < spec.min || value > spec.max) {
    return `${field} ${value} is outside ${spec.min}–${spec.max}`;
  }
  return value;
}

/**
 * One comma-separated cron field to the sorted set of values it names, or
 * null for an unrestricted `*`. Accepts `N`, `A-B`, `*\/S`, `A-B/S`, `A/S`
 * (from A to the field's max, as Vixie cron reads it) and three-letter names.
 */
function parseField(text: string, field: CalendarField): number[] | null | string {
  const spec = FIELD_SPECS[field];
  const values = new Set<number>();
  let restricted = false;
  for (const part of text.split(",")) {
    if (part === "") return `${field} has an empty entry`;
    const [rangeText, stepText, extra] = part.split("/");
    if (extra !== undefined || rangeText === undefined) return `"${part}" is not a valid ${field}`;
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) === 0) {
        return `"${part}" has an invalid step`;
      }
      step = Number(stepText);
    }
    let low: number;
    let high: number;
    if (rangeText === "*") {
      if (stepText === undefined) {
        // A bare `*` anywhere in the list makes the whole field unrestricted.
        if (part === text) return null;
        return `"${text}" mixes * with other values`;
      }
      low = spec.min;
      high = spec.max;
    } else {
      const [lowText, highText, more] = rangeText.split("-");
      if (more !== undefined || lowText === undefined) return `"${part}" is not a valid ${field}`;
      const parsedLow = parseNumber(lowText, spec, field);
      if (typeof parsedLow === "string") return parsedLow;
      low = parsedLow;
      if (highText === undefined) {
        high = stepText === undefined ? low : spec.max;
      } else {
        const parsedHigh = parseNumber(highText, spec, field);
        if (typeof parsedHigh === "string") return parsedHigh;
        high = parsedHigh;
      }
      if (high < low) return `"${part}" runs backwards`;
    }
    restricted = true;
    for (let value = low; value <= high; value += step) values.add(value);
  }
  if (!restricted) return null;
  const list = [...values];
  if (field === "weekday" && list.includes(7)) {
    // Both spellings of Sunday were given, or only 7: launchd takes either,
    // but one value keeps the entry count honest.
    const folded = new Set(list.map((value) => (value === 7 ? 0 : value)));
    return [...folded].sort((a, b) => a - b);
  }
  return list.sort((a, b) => a - b);
}

/** Parses a five-field cron expression. Six fields (with seconds) are refused. */
export function parseCron(expression: string): CronResult {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || parts[0] === "") {
    return {
      ok: false,
      error: `Expected five fields (minute hour day month weekday), got ${parts[0] === "" ? 0 : parts.length}`,
    };
  }
  const fields: Partial<CronFields> = {};
  for (let index = 0; index < CALENDAR_FIELDS.length; index += 1) {
    const field = CALENDAR_FIELDS[index];
    if (field === undefined) continue;
    const parsed = parseField(parts[index] ?? "", field);
    if (typeof parsed === "string") return { ok: false, error: parsed };
    fields[field] = parsed;
  }
  const complete = fields as CronFields;
  const count = entryCount(complete);
  if (count > MAX_ENTRIES) {
    return {
      ok: false,
      error: `That expression is ${count} firing times; launchd takes one entry per combination, and the cap here is ${MAX_ENTRIES}`,
    };
  }
  return { ok: true, fields: complete };
}

export function entryCount(fields: CronFields): number {
  let count = 1;
  for (const field of CALENDAR_FIELDS) {
    const values = fields[field];
    if (values !== null) count *= values.length;
  }
  return count;
}

/**
 * Expands parsed fields into launchd entries: the cartesian product of every
 * restricted field. All-wildcard fields expand to one empty entry, which
 * launchd reads as "every minute".
 */
export function toCalendarEntries(fields: CronFields): CalendarEntry[] {
  let entries: CalendarEntry[] = [{}];
  for (const field of CALENDAR_FIELDS) {
    const values = fields[field];
    if (values === null) continue;
    entries = entries.flatMap((entry) => values.map((value) => ({ ...entry, [field]: value })));
  }
  return entries;
}

/**
 * The reverse: recovers a cron expression from a plist's entries, or null when
 * they do not form one. They form one when every field is either absent from
 * all entries or present in all of them, and the entries are exactly the
 * product of the per-field value sets — which is what `toCalendarEntries`
 * produces, and what a hand-written plist usually is too. Anything else, such
 * as `{Hour: 9, Weekday: 1}` next to `{Hour: 17, Weekday: 5}`, is shown as the
 * raw entries instead.
 */
export function fromCalendarEntries(entries: readonly CalendarEntry[]): CronFields | null {
  if (entries.length === 0) return null;
  const fields: Partial<CronFields> = {};
  for (const field of CALENDAR_FIELDS) {
    const present = entries.filter((entry) => entry[field] !== undefined).length;
    if (present === 0) {
      fields[field] = null;
      continue;
    }
    if (present !== entries.length) return null;
    const values = new Set<number>();
    for (const entry of entries) {
      const value = entry[field];
      if (value === undefined) return null;
      values.add(field === "weekday" && value === 7 ? 0 : value);
    }
    fields[field] = [...values].sort((a, b) => a - b);
  }
  const complete = fields as CronFields;
  if (entryCount(complete) !== entries.length) return null;
  const expected = new Set(toCalendarEntries(complete).map(entryKey));
  for (const entry of entries) {
    if (!expected.has(entryKey(entry))) return null;
  }
  return complete;
}

function entryKey(entry: CalendarEntry): string {
  return CALENDAR_FIELDS.map((field) => {
    const value = entry[field];
    if (value === undefined) return "*";
    return String(field === "weekday" && value === 7 ? 0 : value);
  }).join(" ");
}

/**
 * Prints one field back as compactly as it can be read: `*`, `*\/S` when the
 * values step evenly from the field's minimum to its end, and otherwise
 * contiguous runs joined by commas (`1-5`, `1,3,5`, `0,30`).
 */
export function formatField(values: number[] | null, field: CalendarField): string {
  if (values === null) return "*";
  const spec = FIELD_SPECS[field];
  const max = field === "weekday" ? 6 : spec.max;
  if (values.length > 1) {
    const step = (values[1] ?? 0) - (values[0] ?? 0);
    const even = values.every((value, index) => value === (values[0] ?? 0) + index * step);
    const last = values[values.length - 1] ?? 0;
    if (even && values[0] === spec.min && step > 1 && last + step > max) return `*/${step}`;
  }
  const runs: string[] = [];
  let start = values[0];
  let previous = values[0];
  for (const value of values.slice(1)) {
    if (previous !== undefined && value === previous + 1) {
      previous = value;
      continue;
    }
    runs.push(formatRun(start, previous));
    start = value;
    previous = value;
  }
  runs.push(formatRun(start, previous));
  return runs.join(",");
}

function formatRun(start: number | undefined, end: number | undefined): string {
  if (start === undefined || end === undefined) return "";
  if (start === end) return String(start);
  if (end === start + 1) return `${start},${end}`;
  return `${start}-${end}`;
}

export function formatCron(fields: CronFields): string {
  return CALENDAR_FIELDS.map((field) => formatField(fields[field], field)).join(" ");
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `1,2,3,4,5` reads as `Mon–Fri`; anything not contiguous is listed. */
function labelRange(values: readonly number[], labels: readonly string[]): string {
  const contiguous = values.every((value, index) => index === 0 || value === (values[index - 1] ?? 0) + 1);
  if (contiguous && values.length > 2) {
    return `${labels[values[0] ?? 0]}–${labels[values[values.length - 1] ?? 0]}`;
  }
  return joinList(values.map((value) => labels[value] ?? String(value)));
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Whether `values` is every S-th value from the field's minimum. */
function evenStep(values: readonly number[], min: number, max: number): number | null {
  if (values.length < 2 || values[0] !== min) return null;
  const step = (values[1] ?? 0) - min;
  if (step <= 0) return null;
  const even = values.every((value, index) => value === min + index * step);
  const last = values[values.length - 1] ?? 0;
  return even && last + step > max ? step : null;
}

/**
 * A sentence for the job list: "At 09:00 on Mon–Fri", "Every 15 minutes",
 * "At minute 30 past every hour on day 1". It describes what launchd will
 * do, so it is worth showing next to the expression while it is typed.
 */
export function describeCron(fields: CronFields): string {
  const { minute, hour, day, month, weekday } = fields;
  let when: string;
  if (minute === null && hour === null) {
    when = "Every minute";
  } else if (hour === null) {
    const step = minute === null ? null : evenStep(minute, 0, 59);
    if (minute !== null && step !== null) {
      when = step === 1 ? "Every minute" : `Every ${step} minutes`;
    } else if (minute !== null && minute.length === 1) {
      when = minute[0] === 0 ? "Every hour" : `At minute ${minute[0]} past every hour`;
    } else {
      when = `At minutes ${joinList((minute ?? []).map(String))} past every hour`;
    }
  } else if (minute === null) {
    const hours = hour.map((value) => `${pad(value)}:00–${pad(value)}:59`);
    when = `Every minute between ${joinList(hours)}`;
  } else {
    const hourStep = evenStep(hour, 0, 23);
    if (hourStep !== null && hourStep > 1 && minute.length === 1) {
      when = `Every ${hourStep} hours at :${pad(minute[0] ?? 0)}`;
    } else {
      const times: string[] = [];
      for (const h of hour) for (const m of minute) times.push(`${pad(h)}:${pad(m)}`);
      when = times.length > 6 ? `${times.length} times a day` : `At ${joinList(times)}`;
    }
  }
  const clauses: string[] = [];
  if (day !== null) {
    clauses.push(day.length === 1 ? `on day ${day[0]}` : `on days ${joinList(day.map(String))}`);
  }
  if (weekday !== null) clauses.push(`on ${labelRange(weekday, WEEKDAY_LABELS)}`);
  if (month !== null) clauses.push(`in ${labelRange(month.map((value) => value - 1), MONTH_LABELS)}`);
  if (day !== null && weekday !== null) clauses.push("(both must match)");
  return [when, ...clauses].join(" ");
}

/** For an interval job: "Every 30 seconds", "Every 5 minutes", "Every 2 hours". */
export function describeInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
  }
  return seconds === 1 ? "Every second" : `Every ${seconds} seconds`;
}

/** For entries that do not round-trip to an expression: one line per entry. */
export function describeEntries(entries: readonly CalendarEntry[]): string {
  const lines = entries.slice(0, 4).map((entry) => {
    const parts: string[] = [];
    if (entry.hour !== undefined || entry.minute !== undefined) {
      parts.push(`${entry.hour === undefined ? "**" : pad(entry.hour)}:${entry.minute === undefined ? "**" : pad(entry.minute)}`);
    }
    if (entry.weekday !== undefined) parts.push(WEEKDAY_LABELS[entry.weekday % 7] ?? String(entry.weekday));
    if (entry.day !== undefined) parts.push(`day ${entry.day}`);
    if (entry.month !== undefined) parts.push(MONTH_LABELS[entry.month - 1] ?? String(entry.month));
    return parts.length === 0 ? "every minute" : parts.join(" ");
  });
  const more = entries.length > 4 ? ` and ${entries.length - 4} more` : "";
  return `${entries.length} calendar ${entries.length === 1 ? "rule" : "rules"}: ${lines.join("; ")}${more}`;
}
