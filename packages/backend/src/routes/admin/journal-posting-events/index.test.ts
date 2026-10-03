import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as journalSchema from "../../../db/journal-schema";
import { journalPostingEventsRouter } from "./index";

const db = drizzle(env.DB, { schema });
const journalDb = drizzle(env.DB_JOURNAL, { schema: journalSchema });
const now = new Date();

beforeEach(async () => {
  await journalDb.delete(journalSchema.journalLines);
  await journalDb.delete(journalSchema.journalBatches);
  await db.delete(schema.journalPostingEvents);
});

async function seedEvent(overrides: Partial<typeof schema.journalPostingEvents.$inferInsert> = {}) {
  const id = overrides.id || crypto.randomUUID();
  await db.insert(schema.journalPostingEvents).values({
    id,
    sourceType: "purchase_order",
    sourceRefId: "PO-1",
    eventType: "PREPAYMENT",
    payload: JSON.stringify({
      entryDate: now.toISOString(),
      description: "発注[PO-1]の前払",
      lines: [
        { side: "DEBIT", accountCode: "1151", accountName: "前渡金", amount: 10000 },
        { side: "CREDIT", accountCode: "1111", accountName: "現金預金", amount: 10000 },
      ],
    }),
    status: "FAILED",
    errorMessage: "テスト用の失敗理由",
    requestedById: "EMP001",
    requestedAt: now,
    ...overrides,
  });
  return id;
}

async function callList() {
  const ctx = createExecutionContext();
  const res = await journalPostingEventsRouter.request("/", {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function callRetry(id: string) {
  const ctx = createExecutionContext();
  const res = await journalPostingEventsRouter.request(`/${id}/retry`, { method: "POST" }, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("GET /", () => {
  it("起票イベントを新しい順(requestedAt降順)で返す", async () => {
    await seedEvent({ id: "E-1", sourceRefId: "PO-OLD", requestedAt: new Date(now.getTime() - 1000) });
    await seedEvent({ id: "E-2", sourceRefId: "PO-NEW", requestedAt: now });

    const res = await callList();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; sourceRefId: string }>;
    expect(body).toHaveLength(2);
    expect(body[0].sourceRefId).toBe("PO-NEW");
    expect(body[1].sourceRefId).toBe("PO-OLD");
  });
});

describe("POST /:id/retry", () => {
  it("FAILEDの起票イベントを再転記するとPOSTEDになり、DB_JOURNALへ複式仕訳が書き込まれる", async () => {
    const id = await seedEvent();

    const res = await callRetry(id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "再転記しました" });

    const events = await db
      .select()
      .from(schema.journalPostingEvents)
      .where(eq(schema.journalPostingEvents.id, id));
    expect(events[0].status).toBe("POSTED");

    const batches = await journalDb.select().from(journalSchema.journalBatches);
    expect(batches).toHaveLength(1);
    expect(batches[0].sourceRefId).toBe("PO-1");
  });

  it("既にPOSTED済みの起票イベントを再転記しようとすると400を返す", async () => {
    const id = await seedEvent({ status: "POSTED", postedAt: now, postedBatchId: "B-1" });

    const res = await callRetry(id);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("既に転記済み");
  });

  it("存在しない起票イベントIDを指定すると404を返す", async () => {
    const res = await callRetry("NOPE");
    expect(res.status).toBe(404);
  });
});
