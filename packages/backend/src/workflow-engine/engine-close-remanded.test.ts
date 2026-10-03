import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { WorkflowEngine } from "./engine";

// BUG-015: 差戻しで下書きに戻った伝票を削除した時に、差戻しの申請を閉じる
const db = drizzle(env.DB, { schema });
const past = new Date("2026-09-01T00:00:00Z");

async function seedRequest(id: string, targetId: string, status: string, targetType = "sales_quotes") {
  await db.insert(schema.masterApprovalRequests).values({
    id,
    targetType,
    targetId,
    requestType: "REGISTER",
    status,
    applicantId: "EMP0001",
    comment: "申請時のコメント",
    createdAt: past,
    updatedAt: past,
  });
}

async function seedLog(id: string, requestId: string, targetId: string, status: string) {
  await db.insert(schema.workflowLogs).values({
    id,
    targetType: "sales_quotes",
    targetId,
    approverRoleId: "approver_role",
    approverId: "EMP0002",
    layer: 1,
    status,
    comment: "承認者のコメント",
    performedAt: past,
    requestId,
  });
}

async function requestStatus(id: string) {
  const [row] = await db
    .select()
    .from(schema.masterApprovalRequests)
    .where(eq(schema.masterApprovalRequests.id, id));
  return row.status;
}

async function logStatus(id: string) {
  const [row] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.id, id));
  return row.status;
}

describe("WorkflowEngine.closeRemandedRequestsOfDeletedTarget", () => {
  beforeEach(async () => {
    await db.delete(schema.workflowLogs);
    await db.delete(schema.masterApprovalRequests);
    await db.delete(schema.roles);
    await db.insert(schema.roles).values({ id: "approver_role", name: "承認者", createdAt: past });
  });

  it("差戻しの申請とその差戻しログを CANCELED にする", async () => {
    await seedRequest("req-1", "QT-1", "REMANDED");
    await seedLog("log-1", "req-1", "QT-1", "REMANDED");

    await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(db, "sales_quotes", "QT-1");

    expect(await requestStatus("req-1")).toBe("CANCELED");
    expect(await logStatus("log-1")).toBe("CANCELED");
  });

  it("過去の申請ラウンド(SUPERSEDED)のログ・別の伝票・別の種別の申請は変えない", async () => {
    // 同じ見積の過去ラウンド: 差戻し→再申請で SUPERSEDED になった申請。そのログは履歴として残す
    await seedRequest("req-old", "QT-1", "SUPERSEDED");
    await seedLog("log-old", "req-old", "QT-1", "REMANDED");
    await seedRequest("req-1", "QT-1", "REMANDED");
    await seedLog("log-1", "req-1", "QT-1", "REMANDED");
    // 別の見積・同じ ID の別の種別
    await seedRequest("req-other", "QT-2", "REMANDED");
    await seedRequest("req-type", "QT-1", "REMANDED", "sales_orders");

    await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(db, "sales_quotes", "QT-1");

    expect(await requestStatus("req-1")).toBe("CANCELED");
    expect(await requestStatus("req-old")).toBe("SUPERSEDED");
    expect(await logStatus("log-old")).toBe("REMANDED");
    expect(await requestStatus("req-other")).toBe("REMANDED");
    expect(await requestStatus("req-type")).toBe("REMANDED");
  });

  it("差戻しの申請が無ければ何もしない", async () => {
    await seedRequest("req-done", "QT-1", "APPROVED");

    await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(db, "sales_quotes", "QT-1");

    expect(await requestStatus("req-done")).toBe("APPROVED");
  });
});
