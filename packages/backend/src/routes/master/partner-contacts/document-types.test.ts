import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { partnerContactsRouter } from "./index";
import { PARTNER_CONTACT_DOCUMENT_TYPES } from "../../../constants/contact-document-types";

/**
 * V-5: 取引先担当者の「メールで送る帳票」(documentTypes)の登録・更新・一覧・CSV。
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
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "取引先P-1",
    status: "active",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
});

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

async function request(path: string, init: RequestInit) {
  const ctx = createExecutionContext();
  const res = await partnerContactsRouter.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const reqJson = (path: string, method: string, body?: unknown) =>
  request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

async function storedTypes(id: string) {
  const rows = await db
    .select({ t: schema.partnerContactDocumentTypes.documentType })
    .from(schema.partnerContactDocumentTypes)
    .where(eq(schema.partnerContactDocumentTypes.contactId, id));
  return rows.map((r) => r.t).sort();
}

const sorted = (list: readonly string[]) => [...list].sort();

function csvRequest(csv: string) {
  const form = new FormData();
  form.append("file", new File([csv], "contacts.csv", { type: "text/csv" }));
  return request("/bulk-register", { method: "POST", body: form });
}

const CSV_HEADER_OLD =
  "id,partnerId,contactType,internalUserId,name,email,phone,fax,departmentName,isEmailTarget,memo";
const CSV_HEADER_NEW = `${CSV_HEADER_OLD},documentTypes`;

describe("POST /register: 帳票の指定", () => {
  it("帳票を指定した場合は、その帳票だけが保存される", async () => {
    const res = await reqJson("/register", "POST", { ...baseContact, documentTypes: ["quote", "billing"] });
    expect(res.status).toBe(200);
    expect(await storedTypes("C-1")).toEqual(["billing", "quote"]);
  });

  it("帳票を指定しない場合(旧クライアント)、isEmailTarget=trueなら全帳票が保存される", async () => {
    await reqJson("/register", "POST", baseContact);
    expect(await storedTypes("C-1")).toEqual(sorted(PARTNER_CONTACT_DOCUMENT_TYPES));
  });

  it("帳票を指定しない場合、isEmailTarget=falseならどの帳票も送らない", async () => {
    await reqJson("/register", "POST", { ...baseContact, isEmailTarget: false });
    expect(await storedTypes("C-1")).toEqual([]);
  });

  it("空配列を指定した場合は、isEmailTarget=trueでもどの帳票も送らない", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: [] });
    expect(await storedTypes("C-1")).toEqual([]);
  });

  it("定義にない帳票の指定は400になり、担当者も作られない", async () => {
    const res = await reqJson("/register", "POST", { ...baseContact, documentTypes: ["unknown"] });
    expect(res.status).toBe(400);
    expect(await db.select().from(schema.partnerContacts)).toHaveLength(0);
  });

  it("同じ帳票を重複して指定しても1件だけ保存される", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["quote", "quote"] });
    expect(await storedTypes("C-1")).toEqual(["quote"]);
  });
});

describe("PUT /:id: 帳票の指定", () => {
  const updateBody = {
    partnerId: "P-1",
    contactType: "SALES",
    internalUserId: null,
    name: "担当者1(更新)",
    email: null,
    phone: null,
    fax: null,
    departmentName: null,
    isEmailTarget: true,
    memo: null,
    status: "active",
  };

  it("帳票を指定した場合は置き換わる", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["quote"] });
    const res = await reqJson("/C-1", "PUT", { ...updateBody, documentTypes: ["billing", "purchase_order"] });
    expect(res.status).toBe(200);
    expect(await storedTypes("C-1")).toEqual(["billing", "purchase_order"]);
  });

  it("帳票を指定しない場合は、既存の設定を変えない", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["quote"] });
    await reqJson("/C-1", "PUT", updateBody);
    expect(await storedTypes("C-1")).toEqual(["quote"]);
  });

  it("空配列を指定すると、どの帳票も送らない設定になる", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["quote"] });
    await reqJson("/C-1", "PUT", { ...updateBody, documentTypes: [] });
    expect(await storedTypes("C-1")).toEqual([]);
  });
});

describe("GET /: 一覧の帳票", () => {
  it("各担当者の帳票が定義順の配列(documentTypes)で返る", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["billing", "quote"] });
    await reqJson("/register", "POST", { ...baseContact, id: "C-2", documentTypes: [] });

    const res = await reqJson("/", "GET");
    const rows = (await res.json()) as { id: string; documentTypes: string[] }[];
    expect(rows.find((r) => r.id === "C-1")?.documentTypes).toEqual(["quote", "billing"]);
    expect(rows.find((r) => r.id === "C-2")?.documentTypes).toEqual([]);

    const paged = await reqJson("/?page=1&limit=10", "GET");
    const pagedBody = (await paged.json()) as { data: { id: string; documentTypes: string[] }[] };
    expect(pagedBody.data.find((r) => r.id === "C-1")?.documentTypes).toEqual(["quote", "billing"]);
  });
});

describe("担当者の削除", () => {
  it("削除すると帳票の設定も消える", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["quote"] });
    await reqJson("/C-1/suspend", "POST");
    const res = await reqJson("/C-1", "DELETE");
    expect(res.status).toBe(200);
    expect(await storedTypes("C-1")).toEqual([]);
  });
});

describe("CSV", () => {
  it("ダウンロードには帳票の列が「:」区切りで含まれる", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["billing", "quote"] });
    const res = await reqJson("/csv-download", "GET");
    const text = await res.text();
    const [header, row] = text.replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(header.split(",").at(-1)).toBe("documentTypes");
    expect(row.split(",").at(-1)).toBe('"quote:billing"');
  });

  it("帳票の列がある場合は、その内容で置き換わる(「:」「;」どちらの区切りも可、空欄=送らない)", async () => {
    const csv = [
      CSV_HEADER_NEW,
      '"C-1","P-1","SALES","","A","","","","",1,"","quote:billing"',
      '"C-2","P-1","SALES","","B","","","","",1,"","sales_order;delivery_note"',
      '"C-3","P-1","SALES","","C","","","","",1,"",""',
    ].join("\n");
    const res = await csvRequest(csv);
    expect(res.status).toBe(200);
    expect(await storedTypes("C-1")).toEqual(["billing", "quote"]);
    expect(await storedTypes("C-2")).toEqual(["delivery_note", "sales_order"]);
    expect(await storedTypes("C-3")).toEqual([]);
  });

  it("帳票の列がある既存の担当者は、置き換わる", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["quote"] });
    const csv = [CSV_HEADER_NEW, '"C-1","P-1","SALES","","A","","","","",1,"","billing"'].join("\n");
    await csvRequest(csv);
    expect(await storedTypes("C-1")).toEqual(["billing"]);
  });

  it("帳票の列が無い旧形式のCSVでは、新規はisEmailTargetに従い、既存は帳票の設定を変えない", async () => {
    await reqJson("/register", "POST", { ...baseContact, documentTypes: ["quote"] });
    const csv = [
      CSV_HEADER_OLD,
      '"C-1","P-1","SALES","","A","","","","",1,""',
      '"C-2","P-1","SALES","","B","","","","",1,""',
      '"C-3","P-1","SALES","","C","","","","",0,""',
    ].join("\n");
    const res = await csvRequest(csv);
    expect(res.status).toBe(200);
    expect(await storedTypes("C-1")).toEqual(["quote"]);
    expect(await storedTypes("C-2")).toEqual(sorted(PARTNER_CONTACT_DOCUMENT_TYPES));
    expect(await storedTypes("C-3")).toEqual([]);
  });

  it("不正な帳票の指定があれば、1件も取り込まずに400(行番号入り)で中断する", async () => {
    const csv = [
      CSV_HEADER_NEW,
      '"C-1","P-1","SALES","","A","","","","",1,"","quote"',
      '"C-2","P-1","SALES","","B","","","","",1,"","quote:unknown"',
    ].join("\n");
    const res = await csvRequest(csv);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("3行目");
    expect(body.message).toContain("unknown");
    expect(await db.select().from(schema.partnerContacts)).toHaveLength(0);
  });
});

// BUG-008: CSV で取り込んだ担当者が、承認機能が無効でも仮登録(temporary)になっていた
describe("CSV 取込の状態", () => {
  const statusOf = async (id: string) =>
    (await db.select().from(schema.partnerContacts).where(eq(schema.partnerContacts.id, id)))[0]?.status;

  it("新規の担当者は、画面の登録と同じ状態(承認機能が無効なら有効)で登録する", async () => {
    const res = await csvRequest([CSV_HEADER_OLD, '"C-1","P-1","SALES","","A","","","","",1,""'].join("\n"));
    expect(res.status).toBe(200);
    expect(await statusOf("C-1")).toBe("active");
  });

  it("既存の担当者の状態は、取り込んでも変えない", async () => {
    await reqJson("/register", "POST", baseContact);
    await db.update(schema.partnerContacts).set({ status: "suspended" }).where(eq(schema.partnerContacts.id, "C-1"));
    const res = await csvRequest([CSV_HEADER_OLD, '"C-1","P-1","SALES","","新しい名前","","","","",1,""'].join("\n"));
    expect(res.status).toBe(200);
    expect(await statusOf("C-1")).toBe("suspended");
  });
});
