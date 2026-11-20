import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { quotesRouter } from "./index";
import { signSessionToken } from "../../../platform/auth/session-token";

// REQ-015: 見積の失注・失注の取消
const db = drizzle(env.DB, { schema });
const now = new Date();

async function cookieOf(userId: string) {
  const token = await signSessionToken(
    { userId, employeeNumber: userId, name: userId, role: "general_user", deptName: "", companyName: "", isAuditEnabled: false },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

async function post(path: string, userId: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await quotesRouter.request(
    path,
    { method: "POST", headers: { Cookie: await cookieOf(userId), "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const quoteOf = async (id: string) => (await db.select().from(schema.quotes).where(eq(schema.quotes.id, id)))[0];

async function seedQuote(id: string, status: string) {
  await db.insert(schema.quotes).values({
    id,
    partnerId: "P-1",
    quoteDate: now,
    status,
    totalAmount: 1100,
    taxAmount: 100,
    createdBy: "u-sales",
    createdAt: now,
    updatedBy: "u-sales",
    updatedAt: now,
  });
}

beforeEach(async () => {
  for (const table of [
    schema.salesOrderItems,
    schema.salesOrders,
    schema.quoteItems,
    schema.quotes,
    schema.rolePermissions,
    schema.permissions,
    schema.userRoles,
    schema.roles,
    schema.partners,
    schema.users,
  ]) {
    await db.delete(table);
  }
  await env.KV_PERMISSIONS.delete("role_permissions:sales");
  await env.KV_PERMISSIONS.delete("role_permissions:viewer");
  await db.insert(schema.users).values([
    { id: "u-sales", employeeNumber: "E-SALES", email: "sales@example.com", name: "営業", createdAt: now, updatedAt: now },
    { id: "u-viewer", employeeNumber: "E-VIEW", email: "view@example.com", name: "閲覧", createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.roles).values([
    { id: "sales", name: "営業", createdAt: now },
    { id: "viewer", name: "閲覧", createdAt: now },
  ]);
  await db.insert(schema.permissions).values([
    { id: "sales_quotes:read", resource: "sales_quotes", action: "read", name: "見積の参照" },
    { id: "sales_quotes:update", resource: "sales_quotes", action: "update", name: "見積の更新" },
  ]);
  await db.insert(schema.rolePermissions).values([
    { roleId: "sales", permissionId: "sales_quotes:read" },
    { roleId: "sales", permissionId: "sales_quotes:update" },
    { roleId: "viewer", permissionId: "sales_quotes:read" },
  ]);
  await db.insert(schema.userRoles).values([
    { userId: "u-sales", roleId: "sales", departmentSurrogateId: null },
    { userId: "u-viewer", roleId: "viewer", departmentSurrogateId: null },
  ]);
  await db.insert(schema.partners).values({ id: "P-1", name: "取引先1", createdBy: "u-sales", createdAt: now, updatedBy: "u-sales", updatedAt: now });
});

describe("見積の失注(REQ-015)", () => {
  it("承認済みの見積を失注にでき、失注日・理由が入る。取り消すと承認済みに戻り、失注日・理由は空になる", async () => {
    await seedQuote("QT-1", "APPROVED");
    const res = await post("/QT-1/mark-lost", "u-sales", { lostDate: "2026-11-15", lostReason: "価格で他社に決まった" });
    expect(res.status).toBe(200);
    expect(await quoteOf("QT-1")).toMatchObject({ status: "LOST", lostDate: "2026-11-15", lostReason: "価格で他社に決まった" });

    const cancel = await post("/QT-1/cancel-lost", "u-sales");
    expect(cancel.status).toBe(200);
    expect(await quoteOf("QT-1")).toMatchObject({ status: "APPROVED", lostDate: null, lostReason: null });
  });

  it("下書きの見積・受注に使われている見積は失注にできない", async () => {
    await seedQuote("QT-DRAFT", "DRAFT");
    expect((await post("/QT-DRAFT/mark-lost", "u-sales", { lostDate: "2026-11-15" })).status).toBe(400);

    await seedQuote("QT-ORDERED", "APPROVED");
    await db.insert(schema.salesOrders).values({
      id: "SO-1",
      partnerId: "P-1",
      sourceQuoteId: "QT-ORDERED",
      orderDate: now,
      status: "DRAFT",
      totalAmount: 0,
      taxAmount: 0,
      createdBy: "u-sales",
      createdAt: now,
      updatedBy: "u-sales",
      updatedAt: now,
    });
    const res = await post("/QT-ORDERED/mark-lost", "u-sales", { lostDate: "2026-11-15" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("SO-1");
    expect((await quoteOf("QT-ORDERED")).status).toBe("APPROVED");
  });

  it("失注日は必須(形式が違うと400)。見積の更新権限が無いと403", async () => {
    await seedQuote("QT-2", "APPROVED");
    expect((await post("/QT-2/mark-lost", "u-sales", { lostDate: "11/15" })).status).toBe(400);
    expect((await post("/QT-2/mark-lost", "u-viewer", { lostDate: "2026-11-15" })).status).toBe(403);
    expect((await quoteOf("QT-2")).status).toBe("APPROVED");
  });

  it("失注でない見積の取消は400", async () => {
    await seedQuote("QT-3", "APPROVED");
    expect((await post("/QT-3/cancel-lost", "u-sales")).status).toBe(400);
  });
});
