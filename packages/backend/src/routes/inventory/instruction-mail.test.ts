import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import * as auditSchema from "../../db/audit-schema";
import type { Env } from "../../types/env";
import { receiptInstructionsRouter } from "./receipt-instructions/index";
import { shipmentInstructionsRouter } from "./shipment-instructions/index";
import { ReceiptInstructionPdfService } from "./receipt-instructions/receipt-instruction-pdf.service";
import { ReceiptInstructionsRepository } from "./receipt-instructions/receipt-instructions.repository";

// REQ-012: 指示書の案内メールは、PDF の発行と同時に自動で送らず、「メール送信」(POST /:id/send-email)で送る
const db = drizzle(env.DB, { schema });
const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });
const now = new Date();

async function seed() {
  await db.delete(schema.receiptInstructionAttachments);
  await db.delete(schema.shipmentInstructionAttachments);
  await db.delete(schema.itemReceiptInstructions);
  await db.delete(schema.itemShipmentInstructions);
  await dbLog.delete(auditSchema.mailDeliveryLogs);
  const audit = { createdBy: "SYSTEM", createdAt: now, updatedBy: "SYSTEM", updatedAt: now };
  await db
    .insert(schema.warehouses)
    .values({ id: "WH-MAIL", name: "メール倉庫", warehouseType: "EXTERNAL", email: "wh@example.com", ...audit })
    .onConflictDoNothing();
  await db.insert(schema.partners).values({ id: "P-MAIL", name: "取引先", ...audit }).onConflictDoNothing();
  const header = { partnerId: "P-MAIL", warehouseId: "WH-MAIL", status: "APPROVED", createdBy: "SYSTEM", createdAt: now };
  await db.insert(schema.itemReceiptInstructions).values([
    { id: "RI-MAIL", instructedReceiveDate: now, ...header },
    { id: "RI-NOPDF", instructedReceiveDate: now, ...header },
  ]);
  await db.insert(schema.itemShipmentInstructions).values({ id: "SI-MAIL", instructedShipDate: now, ...header });
  const attachment = { storageType: "R2", fileType: "PDF", uploadedById: "SYSTEM" };
  await db.insert(schema.receiptInstructionAttachments).values([
    { id: "ATT-OLD", instructionId: "RI-MAIL", fileName: "old.pdf", attachmentR2Path: "x/old.pdf", uploadedAt: new Date(now.getTime() - 60000), ...attachment },
    { id: "ATT-NEW", instructionId: "RI-MAIL", fileName: "new.pdf", attachmentR2Path: "x/new.pdf", uploadedAt: now, ...attachment },
  ]);
  await db.insert(schema.shipmentInstructionAttachments).values({
    id: "ATT-SI",
    instructionId: "SI-MAIL",
    fileName: "si.pdf",
    attachmentR2Path: "x/si.pdf",
    uploadedAt: now,
    ...attachment,
  });
}

async function post(router: Hono<{ Bindings: Env }>, path: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await router.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const mails = () => dbLog.select().from(auditSchema.mailDeliveryLogs);

beforeEach(async () => {
  await seed();
});

describe("指示書の案内メール(REQ-012)", () => {
  it("入荷指示書: 指定した宛先へ、最新の PDF のダウンロードのリンクを付けて送る", async () => {
    const res = await post(receiptInstructionsRouter, "/RI-MAIL/send-email", { recipientEmail: "to@example.com" });
    expect(res.status).toBe(200);
    const [mail] = await mails();
    expect(mail).toMatchObject({ category: "receipt_instruction_issued", documentId: "RI-MAIL", recipientTo: "to@example.com", status: "PENDING" });
    expect(mail.subject).toBe("【入荷指示書発行】ダウンロードのご案内");
    expect(mail.body).toContain("/receipt-instruction-download?instructionId=RI-MAIL&attachmentId=ATT-NEW");
    expect(mail.body).toContain("メール倉庫 御中");
  });

  it("出荷指示書も同じく送れる", async () => {
    const res = await post(shipmentInstructionsRouter, "/SI-MAIL/send-email", { recipientEmail: "to@example.com" });
    expect(res.status).toBe(200);
    const [mail] = await mails();
    expect(mail).toMatchObject({ category: "shipment_instruction_issued", documentId: "SI-MAIL" });
    expect(mail.body).toContain("/shipment-instruction-download?instructionId=SI-MAIL&attachmentId=ATT-SI");
  });

  it("PDF が未発行なら 400、指示書が無ければ 404、メールアドレスが不正なら 400。いずれも送らない", async () => {
    expect((await post(receiptInstructionsRouter, "/RI-NOPDF/send-email", { recipientEmail: "to@example.com" })).status).toBe(400);
    expect((await post(receiptInstructionsRouter, "/RI-NONE/send-email", { recipientEmail: "to@example.com" })).status).toBe(404);
    expect((await post(receiptInstructionsRouter, "/RI-MAIL/send-email", { recipientEmail: "bad" })).status).toBe(400);
    expect(await mails()).toEqual([]);
  });

  it("PDF を発行(保存)しても、案内メールは登録されない(以前は倉庫の連絡先へ自動で送っていた)", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.get("/run", async (c) => {
      const service = new ReceiptInstructionPdfService(new ReceiptInstructionsRepository(c.env.DB));
      const header = (await db.select().from(schema.itemReceiptInstructions).where(eq(schema.itemReceiptInstructions.id, "RI-NOPDF")))[0];
      await service.storePdf(c, "RI-NOPDF", new Uint8Array([37, 80, 68, 70]), { header } as never);
      return c.json({});
    });
    const ctx = createExecutionContext();
    await app.request("/run", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const attachments = await db
      .select()
      .from(schema.receiptInstructionAttachments)
      .where(eq(schema.receiptInstructionAttachments.instructionId, "RI-NOPDF"));
    expect(attachments).toHaveLength(1);
    expect(await mails()).toEqual([]);
  });
});

describe("指示書の案内メールの一括送信(BUG-113)", () => {
  beforeEach(async () => {
    await db.delete(schema.warehouseContacts);
    const audit = { createdBy: "SYSTEM", createdAt: now, updatedBy: "SYSTEM", updatedAt: now };
    await db.insert(schema.warehouseContacts).values([
      { id: "WC-1", warehouseId: "WH-MAIL", name: "担当A", email: "a@example.com", isEmailTarget: true, status: "active", ...audit },
      { id: "WC-2", warehouseId: "WH-MAIL", name: "対象外", email: "b@example.com", isEmailTarget: false, status: "active", ...audit },
      { id: "WC-3", warehouseId: "WH-MAIL", name: "停止", email: "c@example.com", isEmailTarget: true, status: "suspended", ...audit },
    ]);
  });

  it("指示書ごとに、倉庫の登録済みの担当者(メール送信の対象・停止していない)へ送る。PDF が無い指示書は失敗として数える", async () => {
    const res = await post(receiptInstructionsRouter, "/bulk-send-email", { ids: ["RI-MAIL", "RI-NOPDF"] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string; results: Array<{ id: string; status: string }> };
    expect(body.results).toEqual([
      expect.objectContaining({ id: "RI-MAIL", status: "PENDING" }),
      expect.objectContaining({ id: "RI-NOPDF", status: "FAILED" }),
    ]);
    const sent = await mails();
    expect(sent).toHaveLength(1);
    expect(sent[0].recipientTo).toBe("a@example.com");
  });

  it("出荷指示書も同じく送れる。担当者がいない倉庫の指示書は失敗にする", async () => {
    expect((await post(shipmentInstructionsRouter, "/bulk-send-email", { ids: ["SI-MAIL"] })).status).toBe(200);
    expect((await mails())[0].recipientTo).toBe("a@example.com");
    await db.delete(schema.warehouseContacts);
    await dbLog.delete(auditSchema.mailDeliveryLogs);
    const res = await post(shipmentInstructionsRouter, "/bulk-send-email", { ids: ["SI-MAIL"] });
    const body = (await res.json()) as { results: Array<{ status: string; error?: string }> };
    expect(body.results[0]).toMatchObject({ status: "FAILED" });
    expect(await mails()).toEqual([]);
  });
});
