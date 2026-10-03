import { describe, it, expect, vi, afterEach } from "vitest";
import { addMonthsToDate, formatJstDate, todayJst } from "./jst-date";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatJstDate", () => {
  it("日本時間の 0時〜9時(UTC では前日)も、日本時間の日付になる", () => {
    expect(formatJstDate(new Date("2026-09-28T16:00:00Z"))).toBe("2026-09-29");
    expect(formatJstDate(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});

describe("todayJst", () => {
  it("日本時間の午前1時は、日本時間の今日になる", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T16:00:00Z"));
    expect(todayJst()).toBe("2026-09-29");
  });
});

describe("addMonthsToDate", () => {
  it("n か月後(年をまたぐ場合も)", () => {
    expect(addMonthsToDate("2026-09-29", 1)).toBe("2026-10-29");
    expect(addMonthsToDate("2026-12-15", 1)).toBe("2027-01-15");
  });
});
