import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { Env } from "../../types/env";
import { purchaseRecognitionsAdapter } from "./purchase-recognitions.adapter";

/**
 * sales-invoices.adapter.test.tsと同じ方針。REGISTER/UPDATE/DELETEの各分岐を、
 * engine/workflow-tasks.serviceの汎用配線を経由せずadapter単体で直接検証する。
 */

const db = drizzle(env.DB, { schema });
const now = new Date();

beforeEach(async () => {
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.purchaseRecognitionHistoryLogs);
  await db.delete(schema.purchaseRecognitionItems);
  await db.delete(schema.purchaseRecognitionAttachments);
  await db.delete(schema.purchaseRecognitions);
  await db.delete(schema.partners);
  await db.delete(schema.users);

  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "承認者太郎",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "仕入先1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

async function seedRecognition(id: string, status: string) {
  await db.insert(schema.purchaseRecognitions).values({
    id,
    partnerId: "P-1",
    recognitionDate: now,
    status,
    documentType: "PURCHASE",
    totalAmount: 1000,
    taxAmount: 100,
    paymentStatus: "UNPAID",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
}

function buildTestApp() {
  return new Hono<{ Bindings: Env }>();
}

async function withHonoContext<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const app = buildTestApp();
  let result!: T;
  app.get("/run", async (c) => {
    result = await fn(c);
    return c.json({});
  });
  const ctx = createExecutionContext();
  await app.request("/run", {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return result;
}

describe("purchaseRecognitionsAdapter.resolveAmount", () => {
  it("payload.totalAmountがあればそれを使う", async () => {
    const amount = await purchaseRecognitionsAdapter.resolveAmount!({
      db,
      targetId: "SR-1",
      isRegister: true,
      payload: { totalAmount: 5000 },
    });
    expect(amount).toBe(5000);
  });

  it("payload未指定ならDB上のtotalAmountを使う", async () => {
    await seedRecognition("SR-1", "DRAFT");
    const amount = await purchaseRecognitionsAdapter.resolveAmount!({
      db,
      targetId: "SR-1",
      isRegister: true,
      payload: {},
    });
    expect(amount).toBe(1000);
  });
});

describe("purchaseRecognitionsAdapter.applyApproved: REGISTER", () => {
  it("PENDING_APPROVAL状態の仕入をAPPROVEDへ確定する", async () => {
    await seedRecognition("SR-REG-1", "PENDING_APPROVAL");

    await withHonoContext((c) =>
      purchaseRecognitionsAdapter.applyApproved({
        db,
        reqParent: {
          id: "REQ-1",
          targetId: "SR-REG-1",
          targetType: "purchase_recognitions",
          requestType: "REGISTER",
          applicantId: "user-001",
        },
        userId: "user-001",
        now,
        c,
      }),
    );

    const rows = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, "SR-REG-1"));
    expect(rows[0].status).toBe("APPROVED");
  });
});

describe("purchaseRecognitionsAdapter.applyApproved: DELETE", () => {
  it("Contextが渡されればperformRecognitionDeletion相当で物理削除する", async () => {
    await seedRecognition("SR-DEL-1", "PENDING_DELETION");

    await withHonoContext((c) =>
      purchaseRecognitionsAdapter.applyApproved({
        db,
        reqParent: {
          id: "REQ-2",
          targetId: "SR-DEL-1",
          targetType: "purchase_recognitions",
          requestType: "DELETE",
          applicantId: "user-001",
        },
        userId: "user-001",
        now,
        c,
      }),
    );

    const rows = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, "SR-DEL-1"));
    expect(rows).toHaveLength(0);
  });

  it("Contextが無ければ何もせず正常終了する(削除されない)", async () => {
    await seedRecognition("SR-DEL-2", "PENDING_DELETION");

    await purchaseRecognitionsAdapter.applyApproved({
      db,
      reqParent: {
        id: "REQ-3",
        targetId: "SR-DEL-2",
        targetType: "purchase_recognitions",
        requestType: "DELETE",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });

    const rows = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, "SR-DEL-2"));
    expect(rows).toHaveLength(1);
  });
});

describe("purchaseRecognitionsAdapter.applyApproved: UPDATE", () => {
  it("退避スナップショット(header/items)を正式反映してAPPROVEDにする", async () => {
    await seedRecognition("SR-UPD-1", "APPROVED");
    await db.insert(schema.approvalFlows).values({
      id: "FLOW-1",
      name: "仕入承認フロー",
      requestType: "purchase_recognitions",
      minAmount: 0,
      maxAmount: 999999999,
      isActive: true,
    });
    await db.insert(schema.masterApprovalRequests).values({
      id: "REQ-4",
      targetType: "purchase_recognitions",
      targetId: "SR-UPD-1",
      requestType: "UPDATE",
      status: "PENDING",
      flowId: "FLOW-1",
      applicantId: "user-001",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.masterApprovalContexts).values({
      id: "CTX-1",
      requestId: "REQ-4",
      generalMemo: JSON.stringify({
        header: { title: "更新後タイトル", partnerId: "P-1", totalAmount: 2000, taxAmount: 200 },
        items: [{ itemId: "ITEM-9", itemName: "更新後品目", quantity: 2, unitPrice: 1000 }],
      }),
      createdAt: now,
      createdBy: "EMP001",
      updatedAt: now,
      updatedBy: "EMP001",
    });

    await withHonoContext((c) =>
      purchaseRecognitionsAdapter.applyApproved({
        db,
        reqParent: {
          id: "REQ-4",
          targetId: "SR-UPD-1",
          targetType: "purchase_recognitions",
          requestType: "UPDATE",
          applicantId: "user-001",
        },
        userId: "user-001",
        now,
        c,
      }),
    );

    const rows = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, "SR-UPD-1"));
    expect(rows[0].status).toBe("APPROVED");
    expect(rows[0].title).toBe("更新後タイトル");
    // BUG-042: 合計・消費税は申請内容の明細(2個×1,000円)から計算し直す(税込 2,200円・消費税 200円)
    expect(rows[0].totalAmount).toBe(2200);
    expect(rows[0].taxAmount).toBe(200);

    const items = await db
      .select()
      .from(schema.purchaseRecognitionItems)
      .where(eq(schema.purchaseRecognitionItems.purchaseRecognitionId, "SR-UPD-1"));
    expect(items).toHaveLength(1);
    expect(items[0].itemName).toBe("更新後品目");
  });
});

describe("purchaseRecognitionsAdapter.applyRemanded", () => {
  it("REGISTER/UPDATEの差戻しはDRAFTへ戻す", async () => {
    await seedRecognition("SR-REM-1", "PENDING_APPROVAL");
    await purchaseRecognitionsAdapter.applyRemanded!({
      db,
      reqParent: {
        id: "REQ-5",
        targetId: "SR-REM-1",
        targetType: "purchase_recognitions",
        requestType: "REGISTER",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });
    const rows = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, "SR-REM-1"));
    expect(rows[0].status).toBe("DRAFT");
  });

  it("DELETEの差戻しはAPPROVEDへ戻す", async () => {
    await seedRecognition("SR-REM-2", "PENDING_DELETION");
    await purchaseRecognitionsAdapter.applyRemanded!({
      db,
      reqParent: {
        id: "REQ-6",
        targetId: "SR-REM-2",
        targetType: "purchase_recognitions",
        requestType: "DELETE",
        applicantId: "user-001",
      },
      userId: "user-001",
      now,
    });
    const rows = await db
      .select()
      .from(schema.purchaseRecognitions)
      .where(eq(schema.purchaseRecognitions.id, "SR-REM-2"));
    expect(rows[0].status).toBe("APPROVED");
  });
});
