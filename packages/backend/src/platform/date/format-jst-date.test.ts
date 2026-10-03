import { describe, it, expect, vi, afterEach } from "vitest";
import { formatJstDate, todayJst } from "./format-jst-date";
import { generateShortCode } from "../id/generate-short-code";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatJstDate", () => {
  it("日本時間の 0時〜9時(UTC では前日)も、日本時間の日付になる", () => {
    expect(formatJstDate(new Date("2026-09-28T16:00:00Z"))).toBe("2026-09-29");
    expect(formatJstDate(new Date("2026-09-28T14:59:59Z"))).toBe("2026-09-28");
    expect(formatJstDate(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});

describe("todayJst", () => {
  it("日本時間の午前1時(UTC では前日の16時)は、日本時間の今日になる", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T16:00:00Z"));
    expect(todayJst()).toBe("2026-09-29");
  });
});

describe("generateShortCode", () => {
  it("管理番号の日付部分も日本時間", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T16:00:00Z"));
    expect(generateShortCode("X")).toMatch(/^X-20260929-\d{4}$/);
  });
});
