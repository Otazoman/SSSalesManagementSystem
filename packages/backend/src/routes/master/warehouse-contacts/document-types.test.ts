import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { warehouseContactsRouter } from "./index";
import { WAREHOUSE_CONTACT_DOCUMENT_TYPES } from "../../../constants/contact-document-types";

/**
 * V-5: 倉庫担当者の「メールで送る帳票」(出荷指示書・入荷指示書)の登録・更新・一覧。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.warehouseContacts);
  await db.delete(schema.warehouses);
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
  await db.insert(schema.warehouses).values({
    id: "W-1",
    name: "倉庫W-1",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
});

const baseContact = {
  warehouseId: "W-1",
  name: "倉庫担当",
  email: "w@example.com",
  phone: null,
  isEmailTarget: true,
  memo: null,
};

async function reqJson(path: string, method: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await warehouseContactsRouter.request(
    path,
    { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function listRows() {
  const res = await reqJson("/", "GET");
  return (await res.json()) as { id: string; documentTypes: string[] }[];
}

describe("倉庫担当者: メールで送る帳票", () => {
  it("帳票を指定した場合は、その帳票だけが保存され、一覧に返る", async () => {
    const res = await reqJson("/register", "POST", { ...baseContact, documentTypes: ["shipment_instruction"] });
    expect(res.status).toBe(200);
    const rows = await listRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].documentTypes).toEqual(["shipment_instruction"]);
  });

  it("帳票を指定しない場合(旧クライアント)は、isEmailTargetに従い全帳票/送らない", async () => {
    await reqJson("/register", "POST", baseContact);
    await reqJson("/register", "POST", { ...baseContact, isEmailTarget: false });
    const rows = await listRows();
    const sizes = rows.map((r) => r.documentTypes.length).sort();
    expect(sizes).toEqual([0, WAREHOUSE_CONTACT_DOCUMENT_TYPES.length]);
  });

  it("更新: 指定すれば置き換わり、指定しなければ変わらない", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["shipment_instruction"] });
    const [{ id }] = await listRows();
    const updateBody = { name: "更新", email: "w@example.com", phone: null, isEmailTarget: true, memo: null, status: "active" };

    await reqJson(`/${id}`, "PUT", updateBody);
    expect((await listRows())[0].documentTypes).toEqual(["shipment_instruction"]);

    await reqJson(`/${id}`, "PUT", { ...updateBody, documentTypes: ["receipt_instruction"] });
    expect((await listRows())[0].documentTypes).toEqual(["receipt_instruction"]);

    await reqJson(`/${id}`, "PUT", { ...updateBody, documentTypes: [] });
    expect((await listRows())[0].documentTypes).toEqual([]);
  });

  it("定義にない帳票の指定は400になり、連絡先も作られない", async () => {
    const res = await reqJson("/register", "POST", { ...baseContact, documentTypes: ["quote"] });
    expect(res.status).toBe(400);
    expect(await db.select().from(schema.warehouseContacts)).toHaveLength(0);
  });

  it("連絡先を削除すると帳票の設定も消える", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["receipt_instruction"] });
    const [{ id }] = await listRows();
    await reqJson(`/${id}/suspend`, "POST");
    await reqJson(`/${id}`, "DELETE");
    const rows = await db
      .select()
      .from(schema.warehouseContactDocumentTypes)
      .where(eq(schema.warehouseContactDocumentTypes.contactId, id));
    expect(rows).toEqual([]);
  });
});
