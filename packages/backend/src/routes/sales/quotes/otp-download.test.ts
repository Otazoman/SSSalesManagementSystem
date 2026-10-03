import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as otpSchema from "../../../db/otp-schema";
import * as auditSchema from "../../../db/audit-schema";
import { quotesRouter } from "./index";
import { grantAllDocumentTypesToEmailTargets } from "../../../../test/support/contact-document-types";

const PARTNER_ID = "P-OTP-TEST";
const QUOTE_ID = "QT-OTP-TEST";
const ATTACHMENT_ID = "ATT-OTP-TEST";
const R2_PATH = "quotes/QT-OTP-TEST/generated_quote.pdf";
const REGISTERED_EMAIL = "registered@example.com";
const UNREGISTERED_EMAIL = "unregistered@example.com";
const RATE_LIMIT_EMAIL = "rate-limit-target@example.com";

async function seedQuoteWithAttachment() {
  const db = drizzle(env.DB, { schema });
  const now = new Date();

  await db.insert(schema.partners).values({
    id: PARTNER_ID,
    name: "OTPテスト取引先",
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });

  await db.insert(schema.partnerContacts).values({
    id: "PC-OTP-TEST",
    partnerId: PARTNER_ID,
    contactType: "PRIMARY",
    email: REGISTERED_EMAIL,
    isEmailTarget: true,
    status: "active",
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });

  await db.insert(schema.partnerContacts).values({
    id: "PC-OTP-RATE-LIMIT",
    partnerId: PARTNER_ID,
    contactType: "SECONDARY",
    email: RATE_LIMIT_EMAIL,
    isEmailTarget: true,
    status: "active",
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });
  await grantAllDocumentTypesToEmailTargets(env.DB);

  await db.insert(schema.quotes).values({
    id: QUOTE_ID,
    partnerId: PARTNER_ID,
    quoteDate: now,
    totalAmount: 1000,
    taxAmount: 100,
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });

  await db.insert(schema.quoteAttachments).values({
    id: ATTACHMENT_ID,
    quoteId: QUOTE_ID,
    fileName: "見積書_QT-OTP-TEST.pdf",
    storageType: "R2",
    attachmentR2Path: R2_PATH,
    fileType: "PDF",
    uploadedById: "SYSTEM",
    uploadedAt: now,
  });

  await env.QUATES_BUCKET.put(R2_PATH, "dummy-pdf-content", {
    httpMetadata: { contentType: "application/pdf" },
  });
}

async function postJson(path: string, body: unknown) {
  return quotesRouter.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function getLatestOtpCode(email: string): Promise<string> {
  const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
  const rows = await dbOtp
    .select()
    .from(otpSchema.otpChallenges)
    .where(eq(otpSchema.otpChallenges.email, email));
  const latest = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latest) throw new Error("OTP challenge not found");
  return latest.otpCode;
}

describe("Item4-c: OTPダウンロード", () => {
  beforeAll(async () => {
    await seedQuoteWithAttachment();
  });

  it("登録済み連絡先のメールアドレスならOTPが発行・記録される", async () => {
    const res = await postJson(
      `/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: REGISTERED_EMAIL },
    );
    expect(res.status).toBe(200);

    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    const rows = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.email, REGISTERED_EMAIL));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].otpCode).toMatch(/^\d{4}$/);
  });

  it("未登録のメールアドレスの場合は同じ成功メッセージを返すがOTPは発行されない(デフォルト制限ON)", async () => {
    const res = await postJson(
      `/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: UNREGISTERED_EMAIL },
    );
    expect(res.status).toBe(200);

    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    const rows = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.email, UNREGISTERED_EMAIL));
    expect(rows.length).toBe(0);

    const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });
    const mailRows = await dbLog
      .select()
      .from(auditSchema.mailDeliveryLogs)
      .where(eq(auditSchema.mailDeliveryLogs.recipientTo, UNREGISTERED_EMAIL));
    expect(mailRows.length).toBe(0);
  });

  it("正しいOTPで検証するとファイルが返る", async () => {
    await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {
      email: REGISTERED_EMAIL,
    });
    const otpCode = await getLatestOtpCode(REGISTERED_EMAIL);

    const res = await postJson(
      `/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: REGISTERED_EMAIL, otp: otpCode },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const text = await res.text();
    expect(text).toBe("dummy-pdf-content");
  });

  it("誤ったOTPを入力すると400・残り試行回数が減る", async () => {
    await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {
      email: REGISTERED_EMAIL,
    });

    const res = await postJson(
      `/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: REGISTERED_EMAIL, otp: "0000" },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("残り試行可能回数");
  });

  it("試行回数の上限を超えると400でロックアウトされる", async () => {
    await postJson(`/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`, {
      email: REGISTERED_EMAIL,
    });

    for (let i = 0; i < 5; i++) {
      await postJson(`/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`, {
        email: REGISTERED_EMAIL,
        otp: "0000",
      });
    }

    const otpCode = await getLatestOtpCode(REGISTERED_EMAIL);
    const res = await postJson(
      `/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: REGISTERED_EMAIL, otp: otpCode },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("上限");
  });

  it("OTPを発行していない状態で検証すると400", async () => {
    const res = await postJson(
      `/download-verify/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: "never-requested@example.com", otp: "1234" },
    );
    expect(res.status).toBe(400);
  });

  it("同一組み合わせへの短時間の連続リクエストはレート制限され、上限を超えた分は新たなOTPを発行しない", async () => {
    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });

    // 上限(5回)ちょうどまではOTPが発行される
    for (let i = 0; i < 5; i++) {
      const res = await postJson(
        `/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`,
        { email: RATE_LIMIT_EMAIL },
      );
      expect(res.status).toBe(200);
    }

    const rowsAtLimit = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.email, RATE_LIMIT_EMAIL));
    expect(rowsAtLimit.length).toBe(5);

    // 6回目は成功メッセージは返すが、実際には新しいOTPを発行しない
    const res = await postJson(
      `/download-request/${QUOTE_ID}/${ATTACHMENT_ID}`,
      { email: RATE_LIMIT_EMAIL },
    );
    expect(res.status).toBe(200);

    const rowsAfterLimit = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.email, RATE_LIMIT_EMAIL));
    expect(rowsAfterLimit.length).toBe(5);
  });
});
