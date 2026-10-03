import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { containsText, endsWithText, startsWithText } from "./text-search";

const db = drizzle(env.DB);
const LONG_TITLE = "【承認の例】消耗品(定期納品)のお見積";

// 検索対象の値を一時テーブルに入れて、条件に一致した値を返す
async function match(condition: (col: SQL) => SQL): Promise<string[]> {
  const rows = await db.all<{ v: string }>(
    sql`SELECT v FROM text_search_test WHERE ${condition(sql`v`)} ORDER BY v`,
  );
  return rows.map((r) => r.v);
}

describe("text-search", () => {
  beforeAll(async () => {
    await db.run(sql`CREATE TABLE IF NOT EXISTS text_search_test (v TEXT)`);
    await db.run(sql`DELETE FROM text_search_test`);
    for (const v of [LONG_TITLE, "Q-2026-0001", "100%_OFF", "abc", null]) {
      await db.run(sql`INSERT INTO text_search_test (v) VALUES (${v})`);
    }
  });

  it("前提: D1 の LIKE は長い日本語のパターンでエラーになる(BUG-012 の原因)", async () => {
    await expect(
      db.all(sql`SELECT v FROM text_search_test WHERE v LIKE ${`%${LONG_TITLE}%`}`),
    ).rejects.toThrow();
  });

  it("containsText: 長い日本語でも検索できる", async () => {
    expect(await match((c) => containsText(c, LONG_TITLE))).toEqual([LONG_TITLE]);
    expect(await match((c) => containsText(c, "消耗品"))).toEqual([LONG_TITLE]);
  });

  it("containsText: 英字の大文字・小文字を区別しない", async () => {
    expect(await match((c) => containsText(c, "q-2026"))).toEqual(["Q-2026-0001"]);
    expect(await match((c) => containsText(c, "ABC"))).toEqual(["abc"]);
  });

  it("containsText: 「%」「_」はワイルドカードにならない", async () => {
    expect(await match((c) => containsText(c, "%_"))).toEqual(["100%_OFF"]);
    expect(await match((c) => containsText(c, "_"))).toEqual(["100%_OFF"]);
  });

  it("startsWithText・endsWithText", async () => {
    expect(await match((c) => startsWithText(c, "q-"))).toEqual(["Q-2026-0001"]);
    expect(await match((c) => startsWithText(c, "0001"))).toEqual([]);
    expect(await match((c) => endsWithText(c, "0001"))).toEqual(["Q-2026-0001"]);
    expect(await match((c) => endsWithText(c, "のお見積"))).toEqual([LONG_TITLE]);
    expect(await match((c) => endsWithText(c, "Q-"))).toEqual([]);
  });
});
