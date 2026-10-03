import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as otpSchema from "../../../db/otp-schema";
import { receiptInstructionsRouter } from "./index";

/**
 * Item6 Phase6-4: 入荷指示書のOTPダウンロード。
 * shipment-instructions/otp-download.test.tsと対称
 */

const WAREHOUSE_ID = "WH-ROTP-TEST";
const WAREHOUSE_NO_EMAIL_ID = "WH-ROTP-NOEMAIL";
const PARTNER_ID = "P-ROTP-TEST";
const INSTRUCTION_ID = "RI-OTP-TEST";
const INSTRUCTION_NO_EMAIL_ID = "RI-OTP-NOEMAIL";
const ATTACHMENT_ID = "ATT-RI-OTP-TEST";
const ATTACHMENT_NO_EMAIL_ID = "ATT-RI-OTP-NOEMAIL";
const R2_PATH = "receipt-instructions/RI-OTP-TEST/generated_instruction.pdf";
const WAREHOUSE_EMAIL = "warehouse-rotp@example.com";

async function seedInstructionWithAttachment() {
  const db = drizzle(env.DB, { schema });
  const now = new Date();

  await db.insert(schema.warehouses).values([
    {
      id: WAREHOUSE_ID,
      name: "OTPテスト外部倉庫(入荷)",
      warehouseType: "EXTERNAL",
      email: WAREHOUSE_EMAIL,
      createdBy: "SYSTEM",
      createdAt: now,
      updatedBy: "SYSTEM",
      updatedAt: now,
    },
    {
      id: WAREHOUSE_NO_EMAIL_ID,
      name: "メール未登録の外部倉庫(入荷)",
      warehouseType: "EXTERNAL",
      createdBy: "SYSTEM",
      createdAt: now,
      updatedBy: "SYSTEM",
      updatedAt: now,
    },
  ]);

  await db.insert(schema.partners).values({
    id: PARTNER_ID,
    name: "OTPテスト仕入先",
    createdBy: "SYSTEM",
    createdAt: now,
    updatedBy: "SYSTEM",
    updatedAt: now,
  });

  await db.insert(schema.itemReceiptInstructions).values([
    {
      id: INSTRUCTION_ID,
      partnerId: PARTNER_ID,
      warehouseId: WAREHOUSE_ID,
      instructedReceiveDate: now,
      status: "APPROVED",
      createdBy: "SYSTEM",
      createdAt: now,
    },
    {
      id: INSTRUCTION_NO_EMAIL_ID,
      partnerId: PARTNER_ID,
      warehouseId: WAREHOUSE_NO_EMAIL_ID,
      instructedReceiveDate: now,
      status: "APPROVED",
      createdBy: "SYSTEM",
      createdAt: now,
    },
  ]);

  await db.insert(schema.receiptInstructionAttachments).values([
    {
      id: ATTACHMENT_ID,
      instructionId: INSTRUCTION_ID,
      fileName: "入荷指示書_RI-OTP-TEST.pdf",
      storageType: "R2",
      attachmentR2Path: R2_PATH,
      fileType: "PDF",
      uploadedById: "SYSTEM",
      uploadedAt: now,
    },
    {
      id: ATTACHMENT_NO_EMAIL_ID,
      instructionId: INSTRUCTION_NO_EMAIL_ID,
      fileName: "入荷指示書_RI-OTP-NOEMAIL.pdf",
      storageType: "R2",
      attachmentR2Path: "receipt-instructions/RI-OTP-NOEMAIL/generated_instruction.pdf",
      fileType: "PDF",
      uploadedById: "SYSTEM",
      uploadedAt: now,
    },
  ]);

  await env.RECEIPT_INSTRUCTIONS_BUCKET.put(R2_PATH, "dummy-pdf-content", {
    httpMetadata: { contentType: "application/pdf" },
  });
}

async function postJson(path: string, body?: unknown) {
  return receiptInstructionsRouter.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    env,
  );
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

describe("Item6 Phase6-4: 入荷指示書OTPダウンロード", () => {
  beforeAll(async () => {
    await seedInstructionWithAttachment();
  });

  it("倉庫マスタ登録メール宛にOTPが発行・記録される(email入力不要)", async () => {
    const res = await postJson(`/download-request/${INSTRUCTION_ID}/${ATTACHMENT_ID}`);
    expect(res.status).toBe(200);

    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    const rows = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.documentId, INSTRUCTION_ID));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].email).toBe(WAREHOUSE_EMAIL);
    expect(rows[0].documentType).toBe("receipt_instruction");
  });

  it("正しいOTPで検証するとファイルが返る", async () => {
    await postJson(`/download-request/${INSTRUCTION_ID}/${ATTACHMENT_ID}`);
    const otpCode = await getLatestOtpCode(INSTRUCTION_ID);

    const res = await postJson(`/download-verify/${INSTRUCTION_ID}/${ATTACHMENT_ID}`, {
      otp: otpCode,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      fileName: string;
      contentType: string;
      fileBase64: string;
      csv: string;
    };
    expect(body.success).toBe(true);
    expect(body.contentType).toBe("application/pdf");
    expect(atob(body.fileBase64)).toBe("dummy-pdf-content");
    expect(body.csv).toContain("headerId");
  });

  it("倉庫にメールアドレスが未登録の場合はOTP発行要求が400を返す", async () => {
    const res = await postJson(`/download-request/${INSTRUCTION_NO_EMAIL_ID}/${ATTACHMENT_NO_EMAIL_ID}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("メールアドレスが登録されていない");
  });

  it("存在しない入荷指示IDへのOTP発行要求は404を返す", async () => {
    const res = await postJson(`/download-request/NOPE/${ATTACHMENT_ID}`);
    expect(res.status).toBe(404);
  });
});
