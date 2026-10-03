import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { documentCompletionRouter } from "./index";
import { PROGRESS_STAGE_KEYS } from "../progress/progress.schema";

const db = drizzle(env.DB, { schema });
const now = new Date("2026-09-01T00:00:00Z");
const audit = { createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now };

beforeEach(async () => {
  await db.delete(schema.documentCompletionOverrides);
  await db.delete(schema.quotes);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await db.insert(schema.users).values({
    id: "user-001", employeeNumber: "EMP001", email: "emp001@example.com", name: "営業太郎", createdAt: now, updatedAt: now,
  });
  await db.insert(schema.partners).values({ id: "P-1", name: "テスト商事", type: "CUSTOMER", ...audit });
  await db.insert(schema.quotes).values({
    id: "Q-1", title: "見積", partnerId: "P-1", quoteDate: now, status: "APPROVED", totalAmount: 0, taxAmount: 0, ...audit,
  } as never);
});

async function call(path: string, method = "GET", body?: unknown) {
  const ctx = createExecutionContext();
  const res = await documentCompletionRouter.request(
    path,
    { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("伝票の「完了/進行中」の手動設定(進捗確認は閲覧専用のため、各伝票の画面から設定する)", () => {
  it("未設定の伝票はforcedState=null(自動判定)", async () => {
    const res = await call("/quote/Q-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stageKey: "quote", documentId: "Q-1", forcedState: null });
  });

  it("完了に設定→進行中に変更→解除ができ、設定は1伝票1行のまま更新される", async () => {
    expect((await call("/quote/Q-1", "PUT", { forcedState: "COMPLETED" })).status).toBe(200);
    expect(await (await call("/quote/Q-1")).json()).toMatchObject({ forcedState: "COMPLETED" });

    await call("/quote/Q-1", "PUT", { forcedState: "IN_PROGRESS" });
    expect(await (await call("/quote/Q-1")).json()).toMatchObject({ forcedState: "IN_PROGRESS" });
    expect(await db.select().from(schema.documentCompletionOverrides)).toHaveLength(1);

    const cleared = await call("/quote/Q-1", "PUT", { forcedState: null });
    expect(await cleared.json()).toMatchObject({ success: true, forcedState: null });
    expect(await db.select().from(schema.documentCompletionOverrides)).toHaveLength(0);
  });

  it("工程キーが不正・forcedStateが不正なら400、存在しない伝票は404で何も保存しない", async () => {
    expect((await call("/nope/Q-1")).status).toBe(400);
    expect((await call("/nope/Q-1", "PUT", { forcedState: "COMPLETED" })).status).toBe(400);
    expect((await call("/quote/Q-1", "PUT", { forcedState: "DONE" })).status).toBe(400);
    expect((await call("/quote/Q-1", "PUT", {})).status).toBe(400);

    const missing = await call("/quote/Q-NOPE", "PUT", { forcedState: "COMPLETED" });
    expect(missing.status).toBe(404);
    expect(await db.select().from(schema.documentCompletionOverrides)).toHaveLength(0);
  });

  it("全12工程で、伝票の存在確認が実テーブルに対して動く(存在しない伝票はどの工程でも404)", async () => {
    for (const stage of PROGRESS_STAGE_KEYS) {
      const res = await call(`/${stage}/DOES-NOT-EXIST`, "PUT", { forcedState: "COMPLETED" });
      expect(res.status, stage).toBe(404);
    }
  });

  it("同じ伝票番号でも工程が違えば別々に設定できる", async () => {
    await db.insert(schema.salesOrders).values({
      id: "Q-1", partnerId: "P-1", orderDate: now, status: "PENDING", totalAmount: 0, taxAmount: 0, ...audit,
    });

    await call("/quote/Q-1", "PUT", { forcedState: "COMPLETED" });
    await call("/sales_order/Q-1", "PUT", { forcedState: "IN_PROGRESS" });

    expect(await (await call("/quote/Q-1")).json()).toMatchObject({ forcedState: "COMPLETED" });
    expect(await (await call("/sales_order/Q-1")).json()).toMatchObject({ forcedState: "IN_PROGRESS" });
    await db.delete(schema.salesOrders);
  });
});
