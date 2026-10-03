import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as otpSchema from "../../../db/otp-schema";
import * as auditSchema from "../../../db/audit-schema";
import { stockReceiptsRouter } from "./index";
import { grantAllDocumentTypesToEmailTargets } from "../../../../test/support/contact-document-types";

/**
 * 検収書発行(Item9、発注書と同じ方式): OTPダウンロード(発注書と同じメールアドレス入力型)と
 * メール送信(方式A、個別/一括)を検証する。PDFの実バイナリ生成(フォント読込)はotp-download.test.ts
 * と同じ方針でR2へダミーファイルを直接シードすることで迂回する(pdfGenerator自体の検証は
 * 別途TEST_FONT_BASE64バインディングを使う専用テストで担保済み)。
 */

const db = drizzle(env.DB, { schema });
const now = new Date();

const PARTNER_ID = "P-AI-TEST";
const PARTNER_NO_CONTACT_ID = "P-AI-TEST-NOCONTACT";
const HEADER_APPROVED_ID = "SR-AI-TEST-APPROVED";
const HEADER_NO_PDF_ID = "SR-AI-TEST-NOPDF";
const HEADER_UNAPPROVED_ID = "SR-AI-TEST-UNAPPROVED";
const HEADER_NO_CONTACT_ID = "SR-AI-TEST-NOCONTACT";
const ATTACHMENT_APPROVED_ID = "ATT-AI-TEST-APPROVED";
const ATTACHMENT_NO_CONTACT_ID = "ATT-AI-TEST-NOCONTACT";
const R2_PATH_APPROVED = "inventory-documents/acceptance-inspections/SR-AI-TEST-APPROVED/acceptance_inspection.pdf";
const R2_PATH_NO_CONTACT = "inventory-documents/acceptance-inspections/SR-AI-TEST-NOCONTACT/acceptance_inspection.pdf";
const CONTACT_EMAIL = "supplier-ai@example.com";
const CONTACT_EMAIL_2 = "supplier-ai-2@example.com";

async function seedBase() {
  await db.delete(schema.itemReceiptAttachments);
  await db.delete(schema.itemReceiptItems);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.mailTemplateSettings);
  const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
  await dbOtp.delete(otpSchema.otpChallenges);
  const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });
  await dbLog.delete(auditSchema.mailDeliveryLogs);

  await db.insert(schema.partners).values([
    { id: PARTNER_ID, name: "検収書テスト仕入先", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { id: PARTNER_NO_CONTACT_ID, name: "連絡先未登録の仕入先", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);

  await db.insert(schema.partnerContacts).values([
    {
      id: "PC-AI-TEST-1",
      partnerId: PARTNER_ID,
      contactType: "PURCHASE",
      name: "仕入担当A",
      email: CONTACT_EMAIL,
      isEmailTarget: true,
      status: "active",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    },
    {
      id: "PC-AI-TEST-2",
      partnerId: PARTNER_ID,
      contactType: "PURCHASE",
      name: "仕入担当B",
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
    id: "acceptance_inspection",
    name: "検収書",
    subjectTemplate: "【{company_name}】検収書のご送付について({doc_id})",
    bodyTemplate: "{company_name}\n\nいつもお世話になっております。検収書をお送りいたします。",
    updatedAt: now,
  });

  await db.insert(schema.itemReceiptHeaders).values([
    {
      id: HEADER_APPROVED_ID,
      partnerId: PARTNER_ID,
      receivedDate: now,
      status: "APPROVED",
      createdBy: "EMP001",
      createdAt: now,
    },
    {
      id: HEADER_NO_PDF_ID,
      partnerId: PARTNER_ID,
      receivedDate: now,
      status: "APPROVED",
      createdBy: "EMP001",
      createdAt: now,
    },
    {
      id: HEADER_UNAPPROVED_ID,
      partnerId: PARTNER_ID,
      receivedDate: now,
      status: "UNAPPROVED",
      createdBy: "EMP001",
      createdAt: now,
    },
    {
      id: HEADER_NO_CONTACT_ID,
      partnerId: PARTNER_NO_CONTACT_ID,
      receivedDate: now,
      status: "APPROVED",
      createdBy: "EMP001",
      createdAt: now,
    },
  ]);

  await db.insert(schema.itemReceiptAttachments).values([
    {
      id: ATTACHMENT_APPROVED_ID,
      receiptHeaderId: HEADER_APPROVED_ID,
      receiptItemId: null,
      fileName: `検収書_${HEADER_APPROVED_ID}.pdf`,
      storageType: "R2",
      attachmentR2Path: R2_PATH_APPROVED,
      fileType: "PDF",
      uploadedById: "EMP001",
      uploadedAt: now,
    },
    {
      id: ATTACHMENT_NO_CONTACT_ID,
      receiptHeaderId: HEADER_NO_CONTACT_ID,
      receiptItemId: null,
      fileName: `検収書_${HEADER_NO_CONTACT_ID}.pdf`,
      storageType: "R2",
      attachmentR2Path: R2_PATH_NO_CONTACT,
      fileType: "PDF",
      uploadedById: "EMP001",
      uploadedAt: now,
    },
  ]);

  await env.SYSTEM_BUCKET.put(R2_PATH_APPROVED, "dummy-acceptance-inspection-pdf", {
    httpMetadata: { contentType: "application/pdf" },
  });
  await env.SYSTEM_BUCKET.put(R2_PATH_NO_CONTACT, "dummy-acceptance-inspection-pdf-nocontact", {
    httpMetadata: { contentType: "application/pdf" },
  });

  await env.COMPANY_SETTINGS.put(
    "config",
    JSON.stringify({ site_url: "https://example.test", is_otp_download_restricted_to_contacts: true }),
  );
}

beforeEach(async () => {
  await seedBase();
});

async function postJson(path: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await stockReceiptsRouter.request(
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

async function getLatestOtpCode(documentId: string): Promise<string> {
  const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
  const rows = await dbOtp
    .select()
    .from(otpSchema.otpChallenges)
    .where(eq(otpSchema.otpChallenges.documentId, documentId));
  const latest = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latest) throw new Error("OTP challenge not found");
  return latest.otpCode;
}

describe("検収書OTPダウンロード(発注書と同じメールアドレス入力型)", () => {
  it("登録済み連絡先のメールアドレスであればOTPが発行・記録される", async () => {
    const res = await postJson(`/download-request/${HEADER_APPROVED_ID}/${ATTACHMENT_APPROVED_ID}`, {
      email: CONTACT_EMAIL,
    });
    expect(res.status).toBe(200);

    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    const rows = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.documentId, HEADER_APPROVED_ID));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].documentType).toBe("acceptance_inspection");
  });

  it("正しいOTPで検証するとPDF本体が返る", async () => {
    await postJson(`/download-request/${HEADER_APPROVED_ID}/${ATTACHMENT_APPROVED_ID}`, {
      email: CONTACT_EMAIL,
    });
    const otpCode = await getLatestOtpCode(HEADER_APPROVED_ID);

    const res = await postJson(`/download-verify/${HEADER_APPROVED_ID}/${ATTACHMENT_APPROVED_ID}`, {
      email: CONTACT_EMAIL,
      otp: otpCode,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("dummy-acceptance-inspection-pdf");
  });

  it("登録済み連絡先制限が有効な場合、未登録メールアドレスへはOTPを送信しない(200は返すが記録は無い)", async () => {
    const res = await postJson(`/download-request/${HEADER_APPROVED_ID}/${ATTACHMENT_APPROVED_ID}`, {
      email: "unknown@example.com",
    });
    expect(res.status).toBe(200);

    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    const rows = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.documentId, HEADER_APPROVED_ID));
    expect(rows).toHaveLength(0);
  });

  it("存在しない入庫IDへのOTP発行要求は404を返す", async () => {
    const res = await postJson("/download-request/NOPE/NOPE", { email: CONTACT_EMAIL });
    expect(res.status).toBe(404);
  });
});

describe("検収書メール送信(方式A): 個別送信", () => {
  it("承認済みかつ検収書PDF生成済みの入庫へ、指定した宛先で配信予約する", async () => {
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
    expect(logs[0].category).toBe("acceptance_inspection");
    expect(logs[0].body).toContain("/acceptance-inspection-download?receiptId=");
  });

  it("未承認の入庫は404を返す", async () => {
    const res = await postJson(`/${HEADER_UNAPPROVED_ID}/send-email`, { recipientEmail: "custom@example.com" });
    expect(res.status).toBe(404);
  });

  it("メールアドレス不正な形式は400を返す", async () => {
    const res = await postJson(`/${HEADER_APPROVED_ID}/send-email`, { recipientEmail: "not-an-email" });
    expect(res.status).toBe(400);
  });
});

describe("検収書メール送信(方式A): 一括送信", () => {
  it("登録済み連絡先全員を1通のTo(カンマ区切り)にまとめて配信予約する", async () => {
    const res = await postJson("/bulk-send-email", { receiptIds: [HEADER_APPROVED_ID] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string; results: any[] };
    expect(body.success).toBe(true);
    expect(body.message).toContain("予約: 1件");

    const logs = await findMailLogs(HEADER_APPROVED_ID);
    expect(logs).toHaveLength(1);
    expect(logs[0].recipientTo).toContain(CONTACT_EMAIL);
    expect(logs[0].recipientTo).toContain(CONTACT_EMAIL_2);
  });

  it("連絡先未登録の仕入先は失敗として結果に記録され、配信ログにもFAILEDが残る", async () => {
    const res = await postJson("/bulk-send-email", { receiptIds: [HEADER_NO_CONTACT_ID] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string; results: any[] };
    expect(body.message).toContain("失敗: 1件");
    expect(body.results[0].status).toBe("FAILED");

    const logs = await findMailLogs(HEADER_NO_CONTACT_ID);
    expect(logs[0].status).toBe("FAILED");
  });

  it("対象が1件も承認済みでない場合は404を返す", async () => {
    const res = await postJson("/bulk-send-email", { receiptIds: [HEADER_UNAPPROVED_ID] });
    expect(res.status).toBe(404);
  });
});
