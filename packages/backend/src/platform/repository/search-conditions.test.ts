import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { combineConditions } from "./search-conditions";

describe("combineConditions", () => {
  it("条件が0件の場合はundefinedを返す(WHERE句なし=全件取得)", () => {
    const result = combineConditions([]);
    expect(result).toBeUndefined();
  });

  it("条件が1件の場合はそのままのSQL条件を返す", () => {
    const condition = eq(schema.accounts.code, "A001");
    const result = combineConditions([condition]);
    expect(result).toBeDefined();
  });

  it("条件が複数件の場合はand()で結合したSQL条件を返す", () => {
    const condition1 = eq(schema.accounts.code, "A001");
    const condition2 = eq(schema.accounts.status, "active");
    const result = combineConditions([condition1, condition2]);
    expect(result).toBeDefined();
  });
});
