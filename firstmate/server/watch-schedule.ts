/**
 * A watch's schedule: the five fields of a classic crontab line, read in the daemon's local time.
 *
 *     ┌ minute        0–59
 *     │ ┌ hour        0–23
 *     │ │ ┌ day       1–31
 *     │ │ │ ┌ month   1–12
 *     │ │ │ │ ┌ weekday 0–7, Sunday is 0 and 7
 *     * * * * *
 *
 * Each field is `*`, a number, a range `a-b`, any of those stepped with `/n`, or a comma list of
 * them. `@hourly`, `@daily` and `@weekly` stand for `0 * * * *`, `0 0 * * *` and `0 0 * * 0`. No
 * month or day names, no `L`, `W` or `#`. As in cron, when both the day and the weekday are
 * restricted, a minute matches either.
 *
 * Local time is the timezone of the process Paseo's daemon runs in (`TZ`, else the machine's), so
 * `0 9 * * 1-5` is nine in the morning where the captain's Mac is. A minute the daemon was not
 * running for — asleep, stopped — is not made up afterwards; the watch runs at its next match.
 */

export interface Schedule {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  weekdays: ReadonlySet<number>;
  /** The day field was restricted; with the weekday also restricted, either may match. */
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}

const MACROS: Readonly<Record<string, string>> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@weekly": "0 0 * * 0",
};

interface Field {
  name: string;
  min: number;
  max: number;
}

const FIELDS: readonly Field[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "weekday", min: 0, max: 7 },
];

function parseNumber(text: string, field: Field): number {
  if (!/^\d+$/.test(text)) throw new Error(`the ${field.name} field has "${text}", which is not a number`);
  const value = Number(text);
  if (value < field.min || value > field.max) {
    throw new Error(`the ${field.name} field has ${value}, outside ${field.min}–${field.max}`);
  }
  return value;
}

function parseField(text: string, field: Field): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range = "", stepText, extra] = part.split("/");
    if (extra !== undefined) throw new Error(`the ${field.name} field has "${part}", with two steps`);
    const step = stepText === undefined ? 1 : parseNumber(stepText, { name: `${field.name} step`, min: 1, max: field.max });
    let from: number;
    let to: number;
    if (range === "*") {
      from = field.min;
      to = field.max;
    } else if (range.includes("-")) {
      const [start = "", end = ""] = range.split("-");
      from = parseNumber(start, field);
      to = parseNumber(end, field);
      if (from > to) throw new Error(`the ${field.name} field has "${range}", which runs backwards`);
    } else {
      from = parseNumber(range, field);
      // `5/15` is cron's "from 5, every 15", to the end of the field.
      to = stepText === undefined ? from : field.max;
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

/** Reads a schedule, or throws a sentence saying what is wrong with it. */
export function parseSchedule(text: string): Schedule {
  const trimmed = text.trim();
  const expanded = MACROS[trimmed.toLowerCase()] ?? trimmed;
  if (expanded.startsWith("@")) throw new Error(`"${trimmed}" is not one of @hourly, @daily or @weekly`);
  const parts = expanded.split(/\s+/).filter((part) => part !== "");
  if (parts.length !== FIELDS.length) {
    throw new Error(`"${trimmed}" has ${parts.length} fields; a schedule has five: minute hour day month weekday`);
  }
  const [minutes, hours, days, months, weekdays] = FIELDS.map((field, index) => parseField(parts[index] ?? "", field));
  // Sunday is both 0 and 7.
  if (weekdays?.has(7)) weekdays.add(0);
  return {
    minutes: minutes ?? new Set(),
    hours: hours ?? new Set(),
    days: days ?? new Set(),
    months: months ?? new Set(),
    weekdays: weekdays ?? new Set(),
    dayRestricted: parts[2] !== "*",
    weekdayRestricted: parts[4] !== "*",
  };
}

/** Whether the schedule fires in the local minute `at` falls in. */
export function isDue(schedule: Schedule, at: Date): boolean {
  if (!schedule.minutes.has(at.getMinutes())) return false;
  if (!schedule.hours.has(at.getHours())) return false;
  if (!schedule.months.has(at.getMonth() + 1)) return false;
  const day = schedule.days.has(at.getDate());
  const weekday = schedule.weekdays.has(at.getDay());
  if (schedule.dayRestricted && schedule.weekdayRestricted) return day || weekday;
  return day && weekday;
}
