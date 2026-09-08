import { describe, expect, it } from "vitest";
import {
  describeCron,
  describeInterval,
  formatCron,
  fromCalendarEntries,
  parseCron,
  toCalendarEntries,
  type CronFields,
} from "./cron";

function fields(expression: string): CronFields {
  const result = parseCron(expression);
  if (!result.ok) throw new Error(result.error);
  return result.fields;
}

describe("parseCron", () => {
  it("reads every field form", () => {
    expect(fields("0 9 * * 1-5")).toEqual({
      minute: [0],
      hour: [9],
      day: null,
      month: null,
      weekday: [1, 2, 3, 4, 5],
    });
    expect(fields("*/15 * * * *").minute).toEqual([0, 15, 30, 45]);
    expect(fields("5/20 * * * *").minute).toEqual([5, 25, 45]);
    expect(fields("0 9-17/4 * * *").hour).toEqual([9, 13, 17]);
    expect(fields("0 0 1,15 * *").day).toEqual([1, 15]);
    expect(fields("0 0 * jan,jul *").month).toEqual([1, 7]);
    expect(fields("0 0 * * mon,WED").weekday).toEqual([1, 3]);
  });

  it("folds 7 into Sunday", () => {
    expect(fields("0 0 * * 7").weekday).toEqual([0]);
    expect(fields("0 0 * * 0,7").weekday).toEqual([0]);
    expect(fields("0 0 * * 5-7").weekday).toEqual([0, 5, 6]);
  });

  it("rejects what launchd cannot take", () => {
    expect(parseCron("")).toMatchObject({ ok: false });
    expect(parseCron("0 9 * *")).toMatchObject({ ok: false });
    expect(parseCron("0 9 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("60 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("* 24 * * *")).toMatchObject({ ok: false });
    expect(parseCron("*/0 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("5-2 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("*,5 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("a * * * *")).toMatchObject({ ok: false });
    // 60 × 24 × 31 combinations.
    expect(parseCron("* * * * *")).toMatchObject({ ok: true });
    expect(parseCron("*/1 */1 */1 * *")).toMatchObject({ ok: false });
  });
});

describe("calendar entries", () => {
  it("is the cartesian product of restricted fields", () => {
    expect(toCalendarEntries(fields("0,30 9 * * 1,5"))).toEqual([
      { minute: 0, hour: 9, weekday: 1 },
      { minute: 0, hour: 9, weekday: 5 },
      { minute: 30, hour: 9, weekday: 1 },
      { minute: 30, hour: 9, weekday: 5 },
    ]);
    expect(toCalendarEntries(fields("* * * * *"))).toEqual([{}]);
  });

  it("round-trips through a plist", () => {
    for (const expression of ["0 9 * * 1-5", "*/15 * * * *", "0 0 1,15 * *", "30 6 * * *", "* * * * *", "0 */6 * * *"]) {
      const parsed = fields(expression);
      const back = fromCalendarEntries(toCalendarEntries(parsed));
      expect(back).toEqual(parsed);
      expect(formatCron(parsed)).toBe(expression);
    }
  });

  it("formats lists and runs compactly", () => {
    expect(formatCron(fields("1,3,5 * * * *"))).toBe("1,3,5 * * * *");
    expect(formatCron(fields("0 9,10 * * *"))).toBe("0 9,10 * * *");
    expect(formatCron(fields("0 9-12,14 * * *"))).toBe("0 9-12,14 * * *");
    expect(formatCron(fields("0 0 * * 7"))).toBe("0 0 * * 0");
  });

  it("refuses entries that are not a product", () => {
    expect(
      fromCalendarEntries([
        { minute: 0, hour: 9, weekday: 1 },
        { minute: 0, hour: 17, weekday: 5 },
      ]),
    ).toBeNull();
    expect(fromCalendarEntries([{ minute: 0, hour: 9 }, { minute: 0 }])).toBeNull();
    expect(fromCalendarEntries([])).toBeNull();
  });

  it("reads a hand-written plist's Sunday", () => {
    expect(fromCalendarEntries([{ minute: 0, hour: 8, weekday: 7 }])).toEqual({
      minute: [0],
      hour: [8],
      day: null,
      month: null,
      weekday: [0],
    });
  });
});

describe("describeCron", () => {
  it.each([
    ["* * * * *", "Every minute"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["0 * * * *", "Every hour"],
    ["30 * * * *", "At minute 30 past every hour"],
    ["0 9 * * *", "At 09:00"],
    ["0 9 * * 1-5", "At 09:00 on Mon–Fri"],
    ["0,30 9 * * 1,3,5", "At 09:00 and 09:30 on Mon, Wed and Fri"],
    ["0 */6 * * *", "Every 6 hours at :00"],
    ["0 0 1 * *", "At 00:00 on day 1"],
    ["0 0 1,15 * *", "At 00:00 on days 1 and 15"],
    ["0 8 * jan *", "At 08:00 in Jan"],
    ["0 8 1 * 1", "At 08:00 on day 1 on Mon (both must match)"],
    ["* 9 * * *", "Every minute between 09:00–09:59"],
  ])("%s → %s", (expression, sentence) => {
    expect(describeCron(fields(expression))).toBe(sentence);
  });
});

describe("describeInterval", () => {
  it("picks the largest whole unit", () => {
    expect(describeInterval(30)).toBe("Every 30 seconds");
    expect(describeInterval(60)).toBe("Every minute");
    expect(describeInterval(300)).toBe("Every 5 minutes");
    expect(describeInterval(3600)).toBe("Every hour");
    expect(describeInterval(7200)).toBe("Every 2 hours");
    expect(describeInterval(90)).toBe("Every 90 seconds");
  });
});
