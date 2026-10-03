import { describe, it, expect } from "vitest";
import { parsePaginationParams, toOffset, buildPaginationMeta } from "./pagination";

describe("parsePaginationParams", () => {
  it("未指定の場合はデフォルト値(page=1, limit=50)を返す", () => {
    expect(parsePaginationParams({})).toEqual({ page: 1, limit: 50 });
  });

  it("正常な文字列値をパースする", () => {
    expect(parsePaginationParams({ page: "3", limit: "20" })).toEqual({
      page: 3,
      limit: 20,
    });
  });

  it("0以下・非整数・非数値の場合はデフォルトにフォールバックする", () => {
    expect(parsePaginationParams({ page: "0" }).page).toBe(1);
    expect(parsePaginationParams({ page: "-1" }).page).toBe(1);
    expect(parsePaginationParams({ page: "1.5" }).page).toBe(1);
    expect(parsePaginationParams({ page: "abc" }).page).toBe(1);
    expect(parsePaginationParams({ page: "" }).page).toBe(1);
  });

  it("limitはMAX_LIMIT(500)を超えると切り詰められる", () => {
    expect(parsePaginationParams({ limit: "10000" }).limit).toBe(500);
  });
});

describe("toOffset", () => {
  it("page=1の場合はoffset 0を返す", () => {
    expect(toOffset({ page: 1, limit: 50 })).toBe(0);
  });

  it("page=3, limit=20の場合はoffset 40を返す", () => {
    expect(toOffset({ page: 3, limit: 20 })).toBe(40);
  });
});

describe("buildPaginationMeta", () => {
  it("totalPagesを切り上げで計算する", () => {
    const meta = buildPaginationMeta({ page: 1, limit: 20 }, 45);
    expect(meta).toEqual({ page: 1, limit: 20, total: 45, totalPages: 3 });
  });

  it("total 0件の場合はtotalPages 0を返す", () => {
    const meta = buildPaginationMeta({ page: 1, limit: 20 }, 0);
    expect(meta.totalPages).toBe(0);
  });
});
