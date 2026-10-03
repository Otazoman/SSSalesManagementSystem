import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as logSchema from "../../../db/audit-schema";
import { mailLogsRouter } from "./index";

/**
 * 2-4(ページネーション適用)のキャラクタリゼーションテスト。
 * POST /search のpage/limit未指定時・指定時(bodyに含める形)の挙動のみを固定する。
 */

const logDb = drizzle(env.DB_LOG, { schema: logSchema });

beforeEach(async () => {
  await logDb.delete(logSchema.mailDeliveryLogs);
});

async function seedLog(id: string) {
  await logDb.insert(logSchema.mailDeliveryLogs).values({
    id,
    category: "sales_quote",
    documentId: "QT-1",
    smtpFrom: "system@example.com",
    recipientTo: "customer@example.com",
    subject: "見積書送付",
    status: "SUCCESS",
    performedAt: new Date(),
  });
}

async function postSearch(body: unknown) {
    const ctx = createExecutionContext();
  const _res = await mailLogsRouter.request(
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
    await seedLog("mail-1");
    const res = await postSearch({});
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("mail-1");
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await seedLog("mail-1");
    await seedLog("mail-2");
    const res = await postSearch({ page: 1, limit: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});

describe("GET /csv-download", () => {
  it("検索条件に一致する全件をBOM付きCSVで返す(ページ制限なし)", async () => {
    await seedLog("mail-1");
    await seedLog("mail-2");

        const ctx = createExecutionContext();
    const res = await mailLogsRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    // res.text()はTextDecoderの仕様でBOMを読み飛ばすため、生バイト列で検証する
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    expect(text).toContain("送信日時");
    expect(text).toContain("customer@example.com");
    expect(text).toContain("見積書"); // sales_quote カテゴリの日本語変換
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(3); // ヘッダー1行 + データ2行
  });

  it("検索条件(documentId)で絞り込んだ件数のみを返す", async () => {
    await seedLog("mail-1");
    await logDb.insert(logSchema.mailDeliveryLogs).values({
      id: "mail-other",
      category: "sales_quote",
      documentId: "QT-OTHER",
      smtpFrom: "system@example.com",
      recipientTo: "other@example.com",
      subject: "見積書送付",
      status: "SUCCESS",
      performedAt: new Date(),
    });

        const ctx = createExecutionContext();
    const res = await mailLogsRouter.request(
      "/csv-download?documentId=QT-1",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes.slice(3));
    expect(text).toContain("customer@example.com");
    expect(text).not.toContain("other@example.com");
  });
});
