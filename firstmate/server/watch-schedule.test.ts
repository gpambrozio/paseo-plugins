import { describe, expect, it } from "vitest";

import { isDue, parseSchedule } from "./watch-schedule";

/** A local time, as the schedule reads it. */
function at(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe("parseSchedule", () => {
  it("reads steps, ranges, lists and stepped ranges", () => {
    const every5 = parseSchedule("*/5 * * * *");
    expect([...every5.minutes]).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    const mixed = parseSchedule("0,30 9-17/4 * * 1-5");
    expect([...mixed.minutes]).toEqual([0, 30]);
    expect([...mixed.hours]).toEqual([9, 13, 17]);
    expect([...mixed.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseSchedule("10/20 * * * *").minutes]).toEqual([10, 30, 50]);
  });

  it("takes Sunday as 7 as well as 0, and the three macros", () => {
    expect(parseSchedule("0 0 * * 7").weekdays.has(0)).toBe(true);
    expect([...parseSchedule("@hourly").minutes]).toEqual([0]);
    expect([...parseSchedule("@daily").hours]).toEqual([0]);
    expect([...parseSchedule("@weekly").weekdays]).toEqual([0]);
  });

  it("says what is wrong with a schedule it cannot read", () => {
    expect(() => parseSchedule("*/5 * * *")).toThrow(/4 fields; a schedule has five/);
    expect(() => parseSchedule("60 * * * *")).toThrow(/minute field has 60, outside 0–59/);
    expect(() => parseSchedule("*/0 * * * *")).toThrow(/minute step/);
    expect(() => parseSchedule("5-1 * * * *")).toThrow(/runs backwards/);
    expect(() => parseSchedule("* * * JAN *")).toThrow(/not a number/);
    expect(() => parseSchedule("@reboot")).toThrow(/not one of @hourly/);
    expect(() => parseSchedule("")).toThrow(/0 fields/);
  });
});

describe("isDue", () => {
  it("matches the minute, hour and month in local time", () => {
    const schedule = parseSchedule("*/5 9 * 9 *");
    expect(isDue(schedule, at(2026, 9, 25, 9, 10))).toBe(true);
    expect(isDue(schedule, at(2026, 9, 25, 9, 11))).toBe(false);
    expect(isDue(schedule, at(2026, 9, 25, 10, 10))).toBe(false);
    expect(isDue(schedule, at(2026, 10, 25, 9, 10))).toBe(false);
  });

  it("takes either the day or the weekday when both are restricted, as cron does", () => {
    // 2026-09-25 is a Friday, the 1st of October a Thursday.
    const schedule = parseSchedule("0 0 1 * 5");
    expect(isDue(schedule, at(2026, 9, 25, 0, 0))).toBe(true);
    expect(isDue(schedule, at(2026, 10, 1, 0, 0))).toBe(true);
    expect(isDue(schedule, at(2026, 9, 24, 0, 0))).toBe(false);
    // Only the weekday restricted: the day does not widen it.
    expect(isDue(parseSchedule("0 0 * * 5"), at(2026, 10, 1, 0, 0))).toBe(false);
  });
});
