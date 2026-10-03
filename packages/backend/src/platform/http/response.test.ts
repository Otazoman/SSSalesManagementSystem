import { describe, it, expect } from "vitest";
import { buildListResponse } from "./response";

describe("buildListResponse", () => {
  it("dataとpaginationをそのままenvelopeへ詰める", () => {
    const pagination = { page: 1, limit: 20, total: 2, totalPages: 1 };
    const result = buildListResponse(["a", "b"], pagination);
    expect(result).toEqual({ data: ["a", "b"], pagination });
  });

  it("空配列でも正しくenvelopeを組み立てる", () => {
    const pagination = { page: 1, limit: 20, total: 0, totalPages: 0 };
    const result = buildListResponse([], pagination);
    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });
});
