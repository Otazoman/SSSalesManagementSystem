import { describe, it, expect } from "vitest";
import { formatDate, formatYen, DEFAULT_TAX_RATE } from "./format-values";

describe("formatDate", () => {
  it("Date/文字列/数値のいずれもYYYY-MM-DD形式にする", () => {
    expect(formatDate(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09-01");
    expect(formatDate("2026-09-01T12:34:56Z")).toBe("2026-09-01");
  });

  it("未指定・不正な値は空文字にする", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});

describe("formatYen", () => {
  it("3桁区切りの円表記にする", () => {
    expect(formatYen(140600)).toBe("¥140,600");
    expect(formatYen(0)).toBe("¥0");
  });

  it("マイナスは先頭にハイフンを付けて絶対値を表示する(値引き等)", () => {
    expect(formatYen(-1000)).toBe("-¥1,000");
  });

  it("小数は四捨五入する", () => {
    expect(formatYen(1000.5)).toBe("¥1,001");
  });
});

describe("DEFAULT_TAX_RATE", () => {
  it("10%", () => {
    expect(DEFAULT_TAX_RATE).toBe(0.1);
  });
});
