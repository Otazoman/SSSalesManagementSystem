import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import type { Env } from "../../../types/env";
import { signSessionToken } from "../../../platform/auth/session-token";
import { WorkflowTasksService } from "../../workflow/workflow-tasks/workflow-tasks.service";
import { partnerDeliveryDestinationsRouter } from "./index";

vi.mock("../../../workflow-engine/notifier", () => ({
  sendWorkflowMail: vi.fn(async () => {}),
  notifyApprovalRequestSubmitted: vi.fn(async () => {}),
}));

/**
 * 新規要望(2026-09-23): 取引先ごとの複数納品先(受注の納品先選択で使う)。
 * warehouse-contacts(承認ワークフローなしのシンプルなCRUD)と同じ方式のcharacterization test。
 */

async function request(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await partnerDeliveryDestinationsRouter.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const db = drizzle(env.DB, { schema });
const now = new Date();

beforeEach(async () => {
  await db.delete(schema.partnerDeliveryDestinations);
  await db.delete(schema.partners);

  await db.insert(schema.partners).values({
    id: "PARTNER-1",
    name: "取引先1",
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
});

async function registerDestination(name: string, overrides: Record<string, unknown> = {}) {
  return request("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partnerId: "PARTNER-1", name, ...overrides }),
  });
}

describe("GET /", () => {
  it("partnerIdで絞り込んで一覧取得できる", async () => {
    await registerDestination("東京支店");
    await db.insert(schema.partners).values({
      id: "PARTNER-2",
      name: "取引先2",
      createdBy: "system",
      createdAt: now,
      updatedBy: "system",
      updatedAt: now,
    });
    await request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnerId: "PARTNER-2", name: "大阪支店" }),
    });

    const res = await request("/?partnerId=PARTNER-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("東京支店");
  });
});

describe("POST /", () => {
  it("住所・郵便番号・電話番号・備考を保存でき、既定status=activeになる(承認ワークフロー無し)", async () => {
    const res = await registerDestination("東京支店", {
      postalCode: "100-0001",
      address: "東京都千代田区千代田1-1",
      phone: "03-1234-5678",
      memo: "本社近く",
    });
    expect(res.status).toBe(200);

    const listRes = await request("/?partnerId=PARTNER-1");
    const list = (await listRes.json()) as Array<{
      name: string;
      status: string;
      postalCode: string | null;
      address: string | null;
      phone: string | null;
      memo: string | null;
    }>;
    expect(list[0]).toMatchObject({
      name: "東京支店",
      status: "active",
      postalCode: "100-0001",
      address: "東京都千代田区千代田1-1",
      phone: "03-1234-5678",
      memo: "本社近く",
    });
  });

  it("存在しない取引先コードは登録エラー(400)になる", async () => {
    const res = await request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnerId: "NOPE", name: "存在しない取引先の納品先" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /:id, POST /:id/suspend, DELETE /:id", () => {
  async function createAndGetId() {
    const res = await registerDestination("東京支店");
    expect(res.status).toBe(200);
    const listRes = await request("/?partnerId=PARTNER-1");
    const list = (await listRes.json()) as Array<{ id: string }>;
    return list[0].id;
  }

  it("名称・住所を更新できる", async () => {
    const id = await createAndGetId();
    const res = await request(`/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "東京本社",
        address: "新住所",
        status: "active",
      }),
    });
    expect(res.status).toBe(200);

    const listRes = await request("/?partnerId=PARTNER-1");
    const list = (await listRes.json()) as Array<{ name: string; address: string | null }>;
    expect(list[0].name).toBe("東京本社");
    expect(list[0].address).toBe("新住所");
  });

  it("無効化してからでないと物理削除できない", async () => {
    const id = await createAndGetId();

    const deleteBeforeSuspend = await request(`/${id}`, { method: "DELETE" });
    expect(deleteBeforeSuspend.status).toBe(400);

    const suspendRes = await request(`/${id}/suspend`, { method: "POST" });
    expect(suspendRes.status).toBe(200);

    const deleteRes = await request(`/${id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
  });

  it("存在しないIDの無効化は404を返す", async () => {
    const res = await request("/NOPE/suspend", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

// BUG-112: 取引先の承認が有効な時は、納品先の追加・無効化も取引先マスタの承認フローで承認する
describe("BUG-112: 取引先の承認が有効な時の納品先", () => {
  async function cookie(userId: string) {
    const token = await signSessionToken(
      {
        userId,
        employeeNumber: userId,
        name: "テストユーザー",
        role: "user",
        deptName: "テスト部署",
        companyName: "テスト会社",
        isAuditEnabled: true,
      },
      await env.SESSION_SECRET.get(),
      3600,
    );
    return `session_token=${token}`;
  }
  async function send(path: string, init: RequestInit) {
    return request(path, {
      ...init,
      headers: { "Content-Type": "application/json", Cookie: await cookie("applicant-1"), ...(init.headers ?? {}) },
    });
  }
  async function approve() {
    const [log] = await db.select().from(schema.workflowLogs).where(eq(schema.workflowLogs.status, "PENDING"));
    const app = new Hono<{ Bindings: Env }>();
    app.post("/approve", async (c) => c.json(await WorkflowTasksService.approveTask(c, db, await c.req.json())));
    const ctx = createExecutionContext();
    const res = await app.request(
      "/approve",
      {
        method: "POST",
        headers: { Cookie: await cookie("approver-1"), "Content-Type": "application/json" },
        body: JSON.stringify({ logId: log.id, requestId: log.requestId, userId: "approver-1" }),
      },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  beforeEach(async () => {
    await db.delete(schema.workflowLogs);
    await db.delete(schema.masterApprovalContexts);
    await db.delete(schema.masterApprovalRequests);
    await db.delete(schema.approvalFlowSteps);
    await db.delete(schema.approvalFlows);
    await db.delete(schema.userRoles);
    await db.delete(schema.roles);
    await db.delete(schema.users);
    for (const id of ["applicant-1", "approver-1"]) {
      await db.insert(schema.users).values({
        id,
        employeeNumber: id,
        email: `${id}@example.com`,
        name: id,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.insert(schema.roles).values({ id: "approver_role", name: "approver_role", createdAt: now });
    await db.insert(schema.userRoles).values({ userId: "approver-1", roleId: "approver_role", departmentSurrogateId: null });
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_partner_approval_enabled: true }));
  });
  afterEach(async () => {
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));
  });

  async function seedPartnerFlow() {
    await db.insert(schema.approvalFlows).values({
      id: "flow-partners",
      name: "取引先",
      requestType: "master_partners",
      minAmount: 0,
      maxAmount: 999999999,
      isActive: true,
    });
    await db.insert(schema.approvalFlowSteps).values({
      id: "flow-partners-step-1",
      flowId: "flow-partners",
      stepOrder: 1,
      approverRoleId: "approver_role",
    });
  }

  it("追加は仮登録になり、取引先マスタの承認フローで申請され、承認で有効になる", async () => {
    await seedPartnerFlow();

    const res = await send("/register", { method: "POST", body: JSON.stringify({ partnerId: "PARTNER-1", name: "名古屋支店" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe("temporary");

    const [requestRow] = await db.select().from(schema.masterApprovalRequests);
    expect(requestRow).toMatchObject({ targetType: "master_delivery_destinations", targetId: body.id, flowId: "flow-partners" });
    const [pending] = await db.select().from(schema.partnerDeliveryDestinations);
    expect(pending.status).toBe("temporary");

    expect((await approve()).status).toBe(200);
    const [approved] = await db.select().from(schema.partnerDeliveryDestinations);
    expect(approved.status).toBe("active");
  });

  it("承認フローが無ければ申請できず、仮登録の行も残らない", async () => {
    const res = await send("/register", { method: "POST", body: JSON.stringify({ partnerId: "PARTNER-1", name: "名古屋支店" }) });
    expect(res.status).toBe(400);
    expect(await db.select().from(schema.partnerDeliveryDestinations)).toHaveLength(0);
  });

  it("無効化は申請になり(承認待ちの間は操作できない)、承認で無効になる", async () => {
    await seedPartnerFlow();
    await db.insert(schema.partnerDeliveryDestinations).values({
      id: "DD-1",
      partnerId: "PARTNER-1",
      name: "東京支店",
      status: "active",
      createdBy: "system",
      createdAt: now,
      updatedBy: "system",
      updatedAt: now,
    });

    const res = await send("/DD-1/suspend", { method: "POST" });
    expect(res.status).toBe(200);
    const [pending] = await db.select().from(schema.partnerDeliveryDestinations);
    expect(pending.status).toBe("temporary");
    expect((await send("/DD-1/suspend", { method: "POST" })).status).toBe(400);

    expect((await approve()).status).toBe(200);
    const [suspended] = await db.select().from(schema.partnerDeliveryDestinations);
    expect(suspended.status).toBe("suspended");
  });
});
