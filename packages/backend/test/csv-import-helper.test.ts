import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema";
import { IMPORT_ENDPOINTS, importSampleCsv, sampleCsv, sampleFileNames } from "./support/csv-import";

// sampledata/ の取込CSVをテストの前提データとして投入するヘルパー(test/support/csv-import.ts)の動作確認。
// 全CSVの取込順・内容は sampledata-import.test.ts が検証する。
const db = drizzle(env.DB, { schema });

describe("importSampleCsv", () => {
  it("sampledata/ のCSVを本番と同じ取込APIで取り込める", async () => {
    await importSampleCsv("units_import_sample.csv");
    const rows = sampleCsv("units_import_sample.csv").split(/\r?\n/).filter((l) => l.trim() !== "").length - 1;
    expect((await db.select().from(schema.units)).length).toBe(rows);
  });

  it("sampledata/ の全CSVに取込先が定義されている", () => {
    expect(sampleFileNames().filter((f) => !IMPORT_ENDPOINTS[f])).toEqual([]);
  });

  it("取込先が未定義のCSVはエラー", async () => {
    await expect(importSampleCsv("nothing.csv")).rejects.toThrow(/IMPORT_ENDPOINTS/);
  });

  it("取込に失敗した(前提が足りない)時は例外にして、失敗に気付かないまま進まない", async () => {
    // 部署の前提(部署マスタ)が無い状態でユーザーを取り込む → 失敗
    await expect(importSampleCsv("users_import.csv")).rejects.toThrow(/users_import\.csv の取込に失敗/);
  });
});
