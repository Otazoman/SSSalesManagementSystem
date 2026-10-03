import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as auditSchema from "../../../db/audit-schema";
import { stockShipmentsRouter } from "./index";
import { grantAllDocumentTypesToEmailTargets } from "../../../../test/support/contact-document-types";

/**
 * 納品書メール送信(方式A、見積・受注・発注と同じ「選択して送信」パターンへの統一)。
 * 出庫確定時の自動送信(delivery_note_issued)は廃止し、本サービス経由の手動送信
 * (個別/一括)に一本化した。seedBaseはotp-download.test.tsと同じデータ形状を踏襲する。
 */

const db = drizzle(env.DB, { schema });
const now = new Date();

const PARTNER_ID = "P-DN-MAIL";
const PARTNER_NO_CONTACT_ID = "P-DN-MAIL-NOCONTACT";
const HEADER_APPROVED_ID = "SH-DN-MAIL-APPROVED";
const HEADER_UNAPPROVED_ID = "SH-DN-MAIL-UNAPPROVED";
const HEADER_NO_PDF_ID = "SH-DN-MAIL-NOPDF";
const HEADER_NO_CONTACT_ID = "SH-DN-MAIL-NOCONTACT";
const R2_PATH_APPROVED = "inventory-documents/delivery-notes/SH-DN-MAIL-APPROVED/delivery_note.pdf";
const R2_PATH_NO_CONTACT = "inventory-documents/delivery-notes/SH-DN-MAIL-NOCONTACT/delivery_note.pdf";
const CONTACT_EMAIL = "partner-mail@example.com";
const CONTACT_EMAIL_2 = "partner-mail-2@example.com";

async function seedBase() {
  await db.delete(schema.itemShipmentItems);
  await db.delete(schema.itemShipmentHeaders);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.warehouses);
  await db.delete(schema.partners);
  await db.delete(schema.mailTemplateSettings);
  const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });
  await dbLog.delete(auditSchema.mailDeliveryLogs);

  await db.insert(schema.warehouses).values({
    id: "WH-DN-MAIL",
    name: "本社倉庫",
    warehouseType: "INTERNAL",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });

  await db.insert(schema.partners).values([
    { id: PARTNER_ID, name: "メールテスト得意先", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { id: PARTNER_NO_CONTACT_ID, name: "連絡先未登録の得意先", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);

  await db.insert(schema.partnerContacts).values([
    {
      id: "PC-DN-MAIL-1",
      partnerId: PARTNER_ID,
      contactType: "SALES",
      name: "担当者A",
      email: CONTACT_EMAIL,
      isEmailTarget: true,
      status: "active",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    },
    {
      id: "PC-DN-MAIL-2",
      partnerId: PARTNER_ID,
      contactType: "SALES",
      name: "担当者B",
      email: CONTACT_EMAIL_2,
      isEmailTarget: true,
      status: "active",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    },
  ]);
  await grantAllDocumentTypesToEmailTargets(env.DB);

  await db.insert(schema.mailTemplateSettings).values({
    id: "sales_invoice",
    name: "納品書",
    subjectTemplate: "【{company_name}】納品書のご送付について({doc_id})",
    bodyTemplate: "{company_name}\n\nいつもお世話になっております。納品書をお送りいたします。",
    updatedAt: now,
  });

  await db.insert(schema.itemShipmentHeaders).values([
    {
      id: HEADER_APPROVED_ID,
      partnerId: PARTNER_ID,
      shippedDate: now,
      status: "APPROVED",
      deliveryNoteR2Path: R2_PATH_APPROVED,
      createdBy: "EMP001",
      createdAt: now,
    },
    {
      id: HEADER_UNAPPROVED_ID,
      partnerId: PARTNER_ID,
      shippedDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    },
    {
      id: HEADER_NO_PDF_ID,
      partnerId: PARTNER_ID,
      shippedDate: now,
      status: "APPROVED",
      deliveryNoteR2Path: null,
      createdBy: "EMP001",
      createdAt: now,
    },
    {
      id: HEADER_NO_CONTACT_ID,
      partnerId: PARTNER_NO_CONTACT_ID,
      shippedDate: now,
      status: "APPROVED",
      deliveryNoteR2Path: R2_PATH_NO_CONTACT,
      createdBy: "EMP001",
      createdAt: now,
    },
  ]);

  await env.COMPANY_SETTINGS.put("config", JSON.stringify({ site_url: "https://example.test" }));
}

beforeEach(async () => {
  await seedBase();
});

async function postJson(path: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await stockShipmentsRouter.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function findMailLogs(documentId: string) {
  const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });
  return await dbLog
    .select()
    .from(auditSchema.mailDeliveryLogs)
    .where(eq(auditSchema.mailDeliveryLogs.documentId, documentId));
}

describe("納品書メール送信(方式A): 個別送信", () => {
  it("承認済みかつ納品書PDF生成済みの出庫へ、指定した宛先で配信予約する", async () => {
    const res = await postJson(`/${HEADER_APPROVED_ID}/send-email`, {
      recipientEmail: "custom@example.com",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain("custom@example.com");

    const logs = await findMailLogs(HEADER_APPROVED_ID);
    expect(logs).toHaveLength(1);
    expect(logs[0].recipientTo).toBe("custom@example.com");
    expect(logs[0].status).toBe("PENDING");
    expect(logs[0].category).toBe("delivery_note");
    expect(logs[0].subject).toContain("メールテスト得意先");
    expect(logs[0].body).toContain("/delivery-note-download?instructionId=");
  });

  it("メールアドレス未入力/不正な形式は400を返す", async () => {
    const res = await postJson(`/${HEADER_APPROVED_ID}/send-email`, { recipientEmail: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("納品書PDFが未生成で、作成もできない出庫は送信エラー(400)になる", async () => {
    const res = await postJson(`/${HEADER_NO_PDF_ID}/send-email`, { recipientEmail: "custom@example.com" });
    expect(res.status).toBe(400);
  });

  it("未承認の出庫は404を返す", async () => {
    const res = await postJson(`/${HEADER_UNAPPROVED_ID}/send-email`, { recipientEmail: "custom@example.com" });
    expect(res.status).toBe(404);
  });
});

describe("納品書メール送信(方式A): 一括送信", () => {
  it("登録済み連絡先全員を1通のTo(カンマ区切り)にまとめて配信予約する", async () => {
    const res = await postJson("/bulk-send-email", { shipmentHeaderIds: [HEADER_APPROVED_ID] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string; results: any[] };
    expect(body.success).toBe(true);
    expect(body.message).toContain("予約: 1件");
    expect(body.results[0].status).toBe("PENDING");

    const logs = await findMailLogs(HEADER_APPROVED_ID);
    expect(logs).toHaveLength(1);
    expect(logs[0].recipientTo).toContain(CONTACT_EMAIL);
    expect(logs[0].recipientTo).toContain(CONTACT_EMAIL_2);
  });

  it("納品書PDF未生成・連絡先未登録の出庫は失敗として結果に記録され、配信ログにもFAILEDが残る", async () => {
    const res = await postJson("/bulk-send-email", {
      shipmentHeaderIds: [HEADER_NO_PDF_ID, HEADER_NO_CONTACT_ID],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string; results: any[] };
    expect(body.message).toContain("失敗: 2件");
    expect(body.results.every((r) => r.status === "FAILED")).toBe(true);

    const noPdfLogs = await findMailLogs(HEADER_NO_PDF_ID);
    expect(noPdfLogs[0].status).toBe("FAILED");
    const noContactLogs = await findMailLogs(HEADER_NO_CONTACT_ID);
    expect(noContactLogs[0].status).toBe("FAILED");
  });

  it("対象が1件も承認済みでない場合は404を返す", async () => {
    const res = await postJson("/bulk-send-email", { shipmentHeaderIds: [HEADER_UNAPPROVED_ID] });
    expect(res.status).toBe(404);
  });
});

// BUG-030: 納品書PDFの作成(作り直し)。承認時の自動作成に失敗した場合などに、画面から作り直せる
describe("納品書PDFの作成(POST /:id/generate-pdf)", () => {
  it("存在しない出庫は404", async () => {
    const res = await postJson("/SH-NOPE/generate-pdf", {});
    expect(res.status).toBe(404);
  });

  it("未確定(未承認)の出庫は400で理由を返す", async () => {
    const res = await postJson(`/${HEADER_UNAPPROVED_ID}/generate-pdf`, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("確定");
  });

  it("得意先が設定されていない出庫は400で理由を返す", async () => {
    await db.insert(schema.itemShipmentHeaders).values({
      id: "SH-DN-NO-PARTNER",
      partnerId: null,
      shippedDate: now,
      status: "APPROVED",
      createdBy: "EMP001",
      createdAt: now,
    });
    const res = await postJson("/SH-DN-NO-PARTNER/generate-pdf", {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("得意先が設定されていない");
  });

  it("明細の無い出庫は400で理由を返す(作成に失敗しても、理由がわかる)", async () => {
    const res = await postJson(`/${HEADER_NO_PDF_ID}/generate-pdf`, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("明細の無い出庫");
  });

  it("個別送信で PDF が無い場合は、作成を試み、作れなかったことを伝える", async () => {
    const res = await postJson(`/${HEADER_NO_PDF_ID}/send-email`, { recipientEmail: "custom@example.com" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("納品書PDFの作成に失敗しました");
  });
});
