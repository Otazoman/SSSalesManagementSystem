import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as otpSchema from "../../../db/otp-schema";
import { stockShipmentsRouter } from "./index";
import { grantAllDocumentTypesToEmailTargets } from "../../../../test/support/contact-document-types";

/**
 * Item7残課題7: 納品書PDF/納品予定データCSVのOTPダウンロード。
 * shipment-instructions/otp-download.test.tsと同型だが、宛先は倉庫マスタではなく
 * 得意先の連絡先マスタ(partner_contacts)、documentId/attachmentIdはshipmentHeaderIdの使い回し。
 */

const db = drizzle(env.DB, { schema });
const now = new Date();

const WAREHOUSE_ID = "WH-DN-OTP";
const PARTNER_ID = "P-DN-OTP";
const PARTNER_NO_CONTACT_ID = "P-DN-OTP-NOCONTACT";
const ORDER_ID = "SO-DN-OTP";
const ORDER_ITEM_ID = "SOI-DN-OTP";
const HEADER_LINKED_ID = "SH-DN-OTP-LINKED";
const HEADER_STANDALONE_ID = "SH-DN-OTP-STANDALONE";
const HEADER_NO_CONTACT_ID = "SH-DN-OTP-NOCONTACT";
const R2_PATH_LINKED = "inventory-documents/delivery-notes/SH-DN-OTP-LINKED/delivery_note.pdf";
const R2_PATH_STANDALONE = "inventory-documents/delivery-notes/SH-DN-OTP-STANDALONE/delivery_note.pdf";
const R2_PATH_NO_CONTACT = "inventory-documents/delivery-notes/SH-DN-OTP-NOCONTACT/delivery_note.pdf";
const CONTACT_EMAIL = "partner-otp@example.com";

async function seedBase() {
  await db.delete(schema.itemShipmentItems);
  await db.delete(schema.itemShipmentHeaders);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.stocks);
  await db.delete(schema.locations);
  await db.delete(schema.warehouses);
  await db.delete(schema.items);
  await db.delete(schema.accounts);
  await db.delete(schema.units);
  await db.delete(schema.partners);

  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.accounts).values({
    code: "ACC1",
    name: "品目",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.items).values({
    id: "ITEM1",
    name: "テスト品目",
    baseUnitCode: "PCS",
    accountCode: "ACC1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.warehouses).values({
    id: WAREHOUSE_ID,
    name: "本社倉庫",
    warehouseType: "INTERNAL",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.locations).values({
    id: "LOC-DN-OTP",
    warehouseId: WAREHOUSE_ID,
    name: "A-1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.partners).values([
    { id: PARTNER_ID, name: "OTPテスト得意先", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { id: PARTNER_NO_CONTACT_ID, name: "連絡先未登録の得意先", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);
  await db.insert(schema.partnerContacts).values({
    id: "PC-DN-OTP",
    partnerId: PARTNER_ID,
    contactType: "SALES",
    email: CONTACT_EMAIL,
    isEmailTarget: true,
    status: "active",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await grantAllDocumentTypesToEmailTargets(env.DB);

  // 受注紐づき出庫用: 単価100・数量5・金額500の受注明細
  await db.insert(schema.salesOrders).values({
    id: ORDER_ID,
    partnerId: PARTNER_ID,
    orderDate: now,
    status: "APPROVED",
    totalAmount: 500,
    taxAmount: 50,
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
  await db.insert(schema.salesOrderItems).values({
    id: ORDER_ITEM_ID,
    salesOrderId: ORDER_ID,
    itemId: "ITEM1",
    inputType: "MASTER",
    quantity: 5,
    unitPrice: 100,
    amount: 500,
    sortOrder: 0,
  });

  // 出庫ヘッダー1: 受注紐づき、納品書PDF生成済み(直接シード、実際のPDF生成は経由しない)
  await db.insert(schema.itemShipmentHeaders).values({
    id: HEADER_LINKED_ID,
    partnerId: PARTNER_ID,
    salesOrderId: ORDER_ID,
    shippedDate: now,
    status: "APPROVED",
    deliveryNoteR2Path: R2_PATH_LINKED,
    createdBy: "EMP001",
    createdAt: now,
  });
  await db.insert(schema.itemShipmentItems).values({
    id: "SHI-DN-OTP-LINKED",
    shipmentHeaderId: HEADER_LINKED_ID,
    itemId: "ITEM1",
    salesOrderItemId: ORDER_ITEM_ID,
    warehouseId: WAREHOUSE_ID,
    locationId: "LOC-DN-OTP",
    lotNumber: "NONE",
    qualityStatus: "NORMAL",
    shippedQuantity: 5,
    accountCode: "ACC1",
  });

  // 出庫ヘッダー2: 受注に紐づかない単独出庫(価格欄は空欄になるはずのケース)
  await db.insert(schema.itemShipmentHeaders).values({
    id: HEADER_STANDALONE_ID,
    partnerId: PARTNER_ID,
    shippedDate: now,
    status: "APPROVED",
    deliveryNoteR2Path: R2_PATH_STANDALONE,
    createdBy: "EMP001",
    createdAt: now,
  });
  await db.insert(schema.itemShipmentItems).values({
    id: "SHI-DN-OTP-STANDALONE",
    shipmentHeaderId: HEADER_STANDALONE_ID,
    itemId: "ITEM1",
    warehouseId: WAREHOUSE_ID,
    locationId: "LOC-DN-OTP",
    lotNumber: "NONE",
    qualityStatus: "NORMAL",
    shippedQuantity: 3,
    accountCode: "ACC1",
  });

  // 出庫ヘッダー3: 連絡先未登録の得意先向け
  await db.insert(schema.itemShipmentHeaders).values({
    id: HEADER_NO_CONTACT_ID,
    partnerId: PARTNER_NO_CONTACT_ID,
    shippedDate: now,
    status: "APPROVED",
    deliveryNoteR2Path: R2_PATH_NO_CONTACT,
    createdBy: "EMP001",
    createdAt: now,
  });
  await db.insert(schema.itemShipmentItems).values({
    id: "SHI-DN-OTP-NOCONTACT",
    shipmentHeaderId: HEADER_NO_CONTACT_ID,
    itemId: "ITEM1",
    warehouseId: WAREHOUSE_ID,
    locationId: "LOC-DN-OTP",
    lotNumber: "NONE",
    qualityStatus: "NORMAL",
    shippedQuantity: 1,
    accountCode: "ACC1",
  });

  await env.SYSTEM_BUCKET.put(R2_PATH_LINKED, "dummy-delivery-note-pdf", {
    httpMetadata: { contentType: "application/pdf" },
  });
  await env.SYSTEM_BUCKET.put(R2_PATH_STANDALONE, "dummy-delivery-note-pdf-standalone", {
    httpMetadata: { contentType: "application/pdf" },
  });
}

beforeEach(async () => {
  await seedBase();
});

async function postJson(path: string, body?: unknown) {
  return stockShipmentsRouter.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) },
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

describe("Item7残課題7: 納品書OTPダウンロード", () => {
  it("得意先の取引先担当者マスタ登録メール宛にOTPが発行・記録される", async () => {
    const res = await postJson(`/download-request/${HEADER_LINKED_ID}/${HEADER_LINKED_ID}`);
    expect(res.status).toBe(200);

    const dbOtp = drizzle(env.DB_OTP, { schema: otpSchema });
    const rows = await dbOtp
      .select()
      .from(otpSchema.otpChallenges)
      .where(eq(otpSchema.otpChallenges.documentId, HEADER_LINKED_ID));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].email).toBe(CONTACT_EMAIL);
    expect(rows[0].documentType).toBe("delivery_note");
  });

  it("正しいOTPで検証すると、PDF(base64)とCSVの両方に受注番号・単価・金額が含まれる", async () => {
    await postJson(`/download-request/${HEADER_LINKED_ID}/${HEADER_LINKED_ID}`);
    const otpCode = await getLatestOtpCode(HEADER_LINKED_ID);

    const res = await postJson(`/download-verify/${HEADER_LINKED_ID}/${HEADER_LINKED_ID}`, { otp: otpCode });
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
    expect(atob(body.fileBase64)).toBe("dummy-delivery-note-pdf");
    expect(body.csv).toContain(ORDER_ID);
    expect(body.csv).toContain("100"); // unitPrice
    expect(body.csv).toContain("500"); // amount
  });

  it("受注に紐づかない単独出庫でも、価格欄が空欄のままエラーなくCSVが生成される", async () => {
    await postJson(`/download-request/${HEADER_STANDALONE_ID}/${HEADER_STANDALONE_ID}`);
    const otpCode = await getLatestOtpCode(HEADER_STANDALONE_ID);

    const res = await postJson(`/download-verify/${HEADER_STANDALONE_ID}/${HEADER_STANDALONE_ID}`, {
      otp: otpCode,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; csv: string };
    expect(body.success).toBe(true);
    const lines = body.csv.trim().split("\n");
    const headerCols = lines[0].split(",");
    const dataCols = lines[1].split(",");
    const salesOrderIdIdx = headerCols.indexOf("salesOrderId");
    const unitPriceIdx = headerCols.indexOf("unitPrice");
    expect(dataCols[salesOrderIdIdx]).toBe('""');
    expect(dataCols[unitPriceIdx]).toBe('""');
  });

  it("誤ったOTPを入力すると400・残り試行回数が減る", async () => {
    await postJson(`/download-request/${HEADER_LINKED_ID}/${HEADER_LINKED_ID}`);

    const res = await postJson(`/download-verify/${HEADER_LINKED_ID}/${HEADER_LINKED_ID}`, { otp: "000000" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("残り試行可能回数");
  });

  it("得意先に連絡先が未登録の場合はOTP発行要求が400を返す", async () => {
    const res = await postJson(`/download-request/${HEADER_NO_CONTACT_ID}/${HEADER_NO_CONTACT_ID}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("メールアドレスが登録されていない");
  });

  it("存在しない出庫IDへのOTP発行要求は404を返す", async () => {
    const res = await postJson("/download-request/NOPE/NOPE");
    expect(res.status).toBe(404);
  });
});
