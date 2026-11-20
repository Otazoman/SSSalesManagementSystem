import { Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { createDb } from "../../platform/db/create-db";
import { getCompanySettings } from "../../platform/kv/company-settings-cache";
import { enqueueNotification } from "../../platform/notifications/enqueue-notification";
import { resolveOperatorEmployeeNumber } from "../../platform/repository/fallback-operator";
import { logAuditEvent } from "../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../platform/http/http-error";
import { WarehousesRepository } from "../master/warehouses/warehouses.repository";
import type { Env } from "../../types/env";

/**
 * REQ-012: 入荷指示書・出荷指示書の案内メール。以前は PDF を発行すると同時に、倉庫の登録済みの連絡先へ自動で送っていた。
 * 納品書・検収書と同じく、画面の「メール送信」の操作(POST /:id/send-email)で送る形にした。
 * メールの本文・リンクの形は、以前の自動送信と同じ(最新の PDF の添付番号をリンクに入れる)。
 */
export type InstructionKind = "receipt" | "shipment";

const CONFIG = {
  receipt: {
    label: "入荷指示書",
    category: "receipt_instruction_issued",
    downloadPage: "receipt-instruction-download",
    auditAction: "SEND_RECEIPT_INSTRUCTION_EMAIL",
    resourceKey: "inventory_instructions",
    headers: schema.itemReceiptInstructions,
    attachments: schema.receiptInstructionAttachments,
  },
  shipment: {
    label: "出荷指示書",
    category: "shipment_instruction_issued",
    downloadPage: "shipment-instruction-download",
    auditAction: "SEND_SHIPMENT_INSTRUCTION_EMAIL",
    resourceKey: "inventory_instructions",
    headers: schema.itemShipmentInstructions,
    attachments: schema.shipmentInstructionAttachments,
  },
} as const;

export async function sendInstructionEmail(
  c: Context<{ Bindings: Env }>,
  kind: InstructionKind,
  instructionId: string,
  recipientEmail: string,
) {
  const config = CONFIG[kind];
  const db = createDb(c.env.DB);

  const [header] = await db.select().from(config.headers).where(eq(config.headers.id, instructionId)).limit(1);
  if (!header) throw new NotFoundError(`対象の${config.label}が見つかりません`);

  const [latest] = await db
    .select()
    .from(config.attachments)
    .where(eq(config.attachments.instructionId, instructionId))
    .orderBy(desc(config.attachments.uploadedAt))
    .limit(1);
  if (!latest) throw new BadRequestError(`先に${config.label}の PDF を発行してください`);

  const warehouse = await new WarehousesRepository(c.env.DB).findById(header.warehouseId);
  const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
  const siteUrl = String((systemConfig as { site_url?: string }).site_url || "http://localhost:3000").replace(/\/$/, "");
  const downloadLink = `${siteUrl}/${config.downloadPage}?instructionId=${encodeURIComponent(instructionId)}&attachmentId=${encodeURIComponent(latest.id)}`;
  const to = recipientEmail.trim();
  const operatorId = await resolveOperatorEmployeeNumber(c, db);

  await enqueueNotification({
    dbLog: c.env.DB_LOG,
    category: config.category,
    documentId: instructionId,
    recipientTo: to,
    subject: `【${config.label}発行】ダウンロードのご案内`,
    body: [
      `${warehouse?.name ?? ""} 御中`,
      "",
      `${config.label}を発行いたしました。以下のリンクよりダウンロードをお願いいたします。`,
      downloadLink,
      "(リンクを開いた後、本メール宛に送信される確認コードの入力が必要です)",
    ].join("\n"),
    performedById: operatorId,
  });

  c.executionCtx.waitUntil(
    logAuditEvent(c, config.auditAction, config.resourceKey, instructionId, null, {
      recipientEmail: to,
      attachmentId: latest.id,
    }),
  );

  return { success: true, message: `宛先「${to}」へのメール送信を予約しました` };
}

/**
 * BUG-113: 一括の「選択した指示書を一括発行・送信」用。REQ-012 で PDF の発行ではメールを送らないようにしたため、一括の時は
 * PDF を発行した後にこの処理で、指示書ごとに倉庫の登録済みの担当者(メール送信の対象・停止していない・メールアドレスあり)へ送る
 * (以前の自動送信と同じ宛先)。担当者がいない指示書・PDF が無い指示書は失敗として数える(他の指示書は送る)。
 */
export async function sendInstructionEmailsToRegisteredContacts(
  c: Context<{ Bindings: Env }>,
  kind: InstructionKind,
  instructionIds: string[],
) {
  const config = CONFIG[kind];
  const db = createDb(c.env.DB);
  const results: Array<{ id: string; status: "PENDING" | "FAILED"; error?: string }> = [];
  for (const id of instructionIds) {
    try {
      const [header] = await db.select().from(config.headers).where(eq(config.headers.id, id)).limit(1);
      if (!header) throw new NotFoundError(`対象の${config.label}が見つかりません`);
      const contacts = await db
        .select()
        .from(schema.warehouseContacts)
        .where(and(eq(schema.warehouseContacts.warehouseId, header.warehouseId), eq(schema.warehouseContacts.isEmailTarget, true)));
      const emails = contacts
        .filter((ct) => ct.status !== "suspended" && ct.email && ct.email.trim() !== "")
        .map((ct) => ct.email!.trim());
      if (emails.length === 0) {
        throw new BadRequestError("倉庫マスタに、メール送信の対象でメールアドレスのある担当者が登録されていません");
      }
      await sendInstructionEmail(c, kind, id, emails.join(", "));
      results.push({ id, status: "PENDING" });
    } catch (err) {
      results.push({ id, status: "FAILED", error: err instanceof Error ? err.message : String(err) });
    }
  }
  const sent = results.filter((r) => r.status === "PENDING").length;
  const failed = results.length - sent;
  return {
    success: failed === 0,
    message: `${sent} 件の${config.label}のメール送信を予約しました${failed > 0 ? `(失敗: ${failed}件)` : ""}`,
    results,
  };
}
