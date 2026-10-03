import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { partnerContactsRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.users);

  const now = new Date();
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
});

async function seedPartner(id: string, status = "active") {
  const now = new Date();
  await db.insert(schema.partners).values({
    id,
    name: `取引先${id}`,
    status,
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

const baseContact = {
  id: "C-1",
  partnerId: "P-1",
  contactType: "SALES",
  internalUserId: null,
  name: "担当者1",
  email: null,
  phone: null,
  fax: null,
  departmentName: null,
  isEmailTarget: true,
  memo: null,
};

async function reqJson(path: string, method: string, body?: unknown) {
    const ctx = createExecutionContext();
  const _res = await partnerContactsRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

describe("POST /register", () => {
  it("存在しない取引先IDでの登録は400・固定メッセージを返す", async () => {
    const res = await reqJson("/register", "POST", baseContact);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "登録エラー: 指定された取引先コードがマスタに存在しません",
    });
  });

  it("取引停止中の取引先への登録は400・取引先名入りメッセージを返す", async () => {
    await seedPartner("P-1", "suspended");
    const res = await reqJson("/register", "POST", baseContact);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message:
        "登録拒否: 取引先「取引先P-1」は現在取引停止中のため、新しく担当者を登録することはできません",
    });
  });

  it("正常登録は200・固定メッセージを返す", async () => {
    await seedPartner("P-1");
    const res = await reqJson("/register", "POST", baseContact);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "担当者を登録しました",
      status: "active",
      id: baseContact.id,
    });
  });

  it("コード未入力の場合、master_code_formatsの設定(既定PC+4桁)に基づき自動採番される", async () => {
    await seedPartner("P-1");
    const res = await reqJson("/register", "POST", { ...baseContact, id: undefined });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^PC-\d{4}$/);
  });
});

describe("PUT /:id", () => {
  it("更新は200・固定メッセージを返す", async () => {
    await seedPartner("P-1");
    await reqJson("/register", "POST", baseContact);
    const res = await reqJson("/C-1", "PUT", {
      ...baseContact,
      name: "改名",
      status: "active",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "担当者情報を更新しました",
    });
  });
});

describe("DELETE /:id", () => {
  it("無効化前の担当者の削除は400・固定メッセージを返す", async () => {
    await seedPartner("P-1");
    await reqJson("/register", "POST", baseContact);
    const res = await reqJson("/C-1", "DELETE");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態の担当者のみ物理削除できます",
    });
  });

  it("無効化済みの担当者の削除は200・固定メッセージを返す", async () => {
    await seedPartner("P-1");
    await reqJson("/register", "POST", baseContact);
    await reqJson("/C-1/suspend", "POST");
    const res = await reqJson("/C-1", "DELETE");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "担当者を削除しました" });
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await seedPartner("P-1");
    await reqJson("/register", "POST", baseContact);
        const ctx = createExecutionContext();
    const res = await partnerContactsRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((c) => c.id === "C-1")).toBe(true);
  });

  it("page/limit指定時は既存の検索条件を維持したまま{data,pagination}形式で返す", async () => {
    await seedPartner("P-1");
    await reqJson("/register", "POST", baseContact);
    await reqJson("/register", "POST", { ...baseContact, id: "C-2" });
        const ctx = createExecutionContext();
    const res = await partnerContactsRouter.request(
      "/?partnerId=P-1&page=1&limit=1",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});
