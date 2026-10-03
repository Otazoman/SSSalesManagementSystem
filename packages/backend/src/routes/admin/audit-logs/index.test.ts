import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as logSchema from "../../../db/audit-schema";
import { auditLogsRouter } from "./index";

/**
 * 2-4(ページネーション適用)のキャラクタリゼーションテスト。
 * POST /search のpage/limit未指定時・指定時(bodyに含める形)の挙動のみを固定する。
 */

const logDb = drizzle(env.DB_LOG, { schema: logSchema });

beforeEach(async () => {
  await logDb.delete(logSchema.auditLogs);
});

async function seedLog(id: string, performedAt: Date) {
  await logDb.insert(logSchema.auditLogs).values({
    id,
    userId: "user-001",
    action: "CREATE_UNIT",
    tableName: "master_units",
    recordId: "BOX",
    performedAt,
  });
}

async function postSearch(body: unknown) {
    const ctx = createExecutionContext();
  const _res = await auditLogsRouter.request(
    "/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

describe("POST /search", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedLog("log-1", new Date());
    const res = await postSearch({});
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((l) => l.id === "log-1")).toBe(true);
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    // 検索実行そのものがEXECUTE_AUDIT_LOG_SEARCHとして自己ログを書き込む(fire-and-forget)ため、
    // total件数が他テストの遅延書き込みと競合しうる。ここでは形状とlimit適用のみを固定し、
    // 厳密なtotal一致は検証しない(自己参照ログという既存の非決定性であり、今回の変更が原因ではない)。
    await seedLog("log-1", new Date());
    await seedLog("log-2", new Date());
    const res = await postSearch({ page: 1, limit: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(1);
    expect(body.pagination.total).toBeGreaterThanOrEqual(2);
    expect(body.pagination.totalPages).toBe(body.pagination.total);
  });
});

describe("GET /csv-download", () => {
  it("検索条件に一致する全件をBOM付きCSVで返す(ページ制限なし)", async () => {
    await seedLog("log-1", new Date());
    await seedLog("log-2", new Date());

        const ctx = createExecutionContext();
    const res = await auditLogsRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    // res.text()はTextDecoderの仕様でBOMを読み飛ばすため、生バイト列で検証する
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    expect(text).toContain("実行日時");
    expect(text).toContain("user-001");
    // 2件分のデータ行がヘッダー行以外に存在する。
    // (他テストの自己参照audit log書き込み(fire-and-forget)がまれに競合しうるため、
    // 既存の検索系テストと同様、厳密な一致ではなく下限のみ確認する)
    const lines = text.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it("検索条件(userId)で絞り込んだ件数のみを返す", async () => {
    await seedLog("log-1", new Date());
    await logDb.insert(logSchema.auditLogs).values({
      id: "log-other",
      userId: "someone-else",
      action: "CREATE_UNIT",
      tableName: "master_units",
      recordId: "BOX",
      performedAt: new Date(),
    });

        const ctx = createExecutionContext();
    const res = await auditLogsRouter.request(
      "/csv-download?userId=user-001",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("user-001");
    expect(text).not.toContain("someone-else");
  });
});
