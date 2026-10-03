import { describe, it, expect } from "vitest";
import { parseDateTimeToUnixSeconds } from "./date-range";

describe("parseDateTimeToUnixSeconds", () => {
  it("未指定・空文字はnullを返す", () => {
    expect(parseDateTimeToUnixSeconds(undefined, false)).toBeNull();
    expect(parseDateTimeToUnixSeconds("", false)).toBeNull();
    expect(parseDateTimeToUnixSeconds("   ", false)).toBeNull();
  });

  it("不正な日付文字列はnullを返す", () => {
    expect(parseDateTimeToUnixSeconds("not-a-date", false)).toBeNull();
  });

  it("開始日時側は秒を0に正規化する", () => {
    const result = parseDateTimeToUnixSeconds("2026-01-01T10:30:45", false);
    expect(result).not.toBeNull();
    const d = new Date((result as number) * 1000);
    expect(d.getUTCSeconds()).toBe(0);
  });

  it("終了日時側は秒を59に正規化する(その日時を含む範囲にするため)", () => {
    const result = parseDateTimeToUnixSeconds("2026-01-01T10:30:00", true);
    expect(result).not.toBeNull();
    const d = new Date((result as number) * 1000);
    expect(d.getUTCSeconds()).toBe(59);
  });

  it("半角スペース区切りの日時文字列も解釈できる", () => {
    const result = parseDateTimeToUnixSeconds("2026-01-01 10:30:00", false);
    expect(result).not.toBeNull();
  });
});
