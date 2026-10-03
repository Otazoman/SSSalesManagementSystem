import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { partnerDeliveryDestinationsRouter } from "./index";

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
