import { Context } from "hono";
import { Env } from "../../../types/env";
import { ReceiptInstructionsRepository } from "./receipt-instructions.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { WarehouseContactsRepository } from "../../master/warehouse-contacts/warehouse-contacts.repository";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { ProductsRepository } from "../../master/products/products.repository";
import { UnitsRepository } from "../../master/units/units.repository";
import { UserRepository } from "../../admin/users/user.repository";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { type ReportPdfSource, type InstructionPdfData } from "report-renderer";
import { loadCustomLayoutSource } from "../../../platform/report-templates/load-custom-layout";
import { resolveInstructionPlaceholders } from "../../../platform/report-templates/resolve-instruction-placeholders";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { createDb } from "../../../platform/db/create-db";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { todayJst } from "../../../platform/date/format-jst-date";

const RESOURCE_KEY = "inventory_instructions";
const REPORT_TEMPLATE_CATEGORY = "receiving_instruction";

// Item6 Phase6-4: 入荷指示書PDFの生成。shipment-instruction-pdf.service.tsと対称
export class ReceiptInstructionPdfService {
  constructor(private repo: ReceiptInstructionsRepository) {}

  // PERF-07 B-3: PDF を作るためのデータ(GET /:id/pdf-source)。対象が無い・発行できない状態ならエラー。
  // withLayout が false の時(受け取った PDF の保存の時)は、Excel テンプレートのレイアウトを読まない
  async buildPdfSource(c: Context<{ Bindings: Env }>, instructionId: string, withLayout = true) {
    const header = await this.repo.findHeaderById(instructionId);
    if (!header) throw new NotFoundError("対象の入荷指示が見つかりません");
    if (header.status === "UNAPPROVED" || header.status === "REMANDED") {
      throw new BadRequestError(
        "指示書PDFは発行済み(承認確定後)の入荷指示のみ生成できます",
      );
    }

    const items = await this.repo.findItemsByHeaderId(instructionId);
    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const partnersRepo = new PartnersRepository(c.env.DB);
    const productsRepo = new ProductsRepository(c.env.DB);
    const unitsRepo = new UnitsRepository(c.env.DB);
    const usersRepo = new UserRepository(c.env.DB);

    const [warehouse, partner, staffUser] = await Promise.all([
      warehousesRepo.findById(header.warehouseId),
      partnersRepo.findById(header.partnerId),
      usersRepo.findByEmployeeNumber(header.createdBy),
    ]);
    if (!warehouse) throw new NotFoundError(`倉庫が見つかりません: ${header.warehouseId}`);
    if (!partner) throw new NotFoundError(`取引先が見つかりません: ${header.partnerId}`);

    const itemsWithNames = await Promise.all(
      items.map(async (item) => {
        const product = await productsRepo.findProductById(item.itemId);
        const unit = product?.baseUnitCode
          ? await unitsRepo.findUnitByCode(product.baseUnitCode)
          : null;
        return {
          itemId: item.itemId,
          itemName: product?.name || item.itemId,
          // ロット未指定時の既定値"NONE"はそのまま表示すると紛らわしいため、帳票上は空欄にする
          lotNumber: item.lotNumber === "NONE" ? "" : item.lotNumber,
          quantity: item.instructedQuantity,
          unit: unit?.name || product?.baseUnitCode || "",
          remark: item.memo || "",
        };
      }),
    );

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};

    const instructionData: InstructionPdfData = {
      documentTitle: "入荷指示書",
      code: instructionId,
      date: todayJst(),
      recipientLabel: "入荷元(外部倉庫)",
      recipientName: warehouse.name,
      recipientAddress: warehouse.address,
      recipientTel: warehouse.phoneNumber,
      partnerLabel: "仕入先",
      partnerName: partner.name,
      scheduledDateLabel: "入荷予定日",
      scheduledDate: new Date(header.instructedReceiveDate).toISOString().slice(0, 10),
      companyName: (systemConfig as any).company_name || "",
      companyZip: (systemConfig as any).company_zip || "",
      companyAddress: (systemConfig as any).company_address || "",
      companyTel: (systemConfig as any).company_tel || "",
      companyFax: (systemConfig as any).company_fax || "",
      memo: header.memo,
      staffName: staffUser?.name || header.createdBy,
      items: itemsWithNames,
    };

    // 帳票Excelテンプレートが登録・コンパイル済みならそちらを優先し、未登録・失敗時は
    // 既定のpdf-lib直描画へフォールバックする(見積書と同じ方針)
    const customLayout = !withLayout
      ? null
      : await loadCustomLayoutSource(c.env, REPORT_TEMPLATE_CATEGORY, () => resolveInstructionPlaceholders(instructionData));
    const source: ReportPdfSource = {
      documentType: REPORT_TEMPLATE_CATEGORY,
      customLayout,
      fallback: { kind: "instruction", data: instructionData },
    };
    return { source, header, systemConfig, warehouse };
  }

  // PERF-07 B-4: できた PDF を保存し、記録・倉庫への案内メール・監査ログを残す(generate-pdf と、ブラウザから受け取った PDF の両方)
  async storePdf(
    c: Context<{ Bindings: Env }>,
    instructionId: string,
    pdfBinary: Uint8Array,
    built: Omit<Awaited<ReturnType<ReceiptInstructionPdfService["buildPdfSource"]>>, "source">,
    uploadedBy?: { userId: string; size: number },
  ) {
    const { header, systemConfig, warehouse } = built;

    const r2Path = generateAttachmentKey(
      `receipt-instructions/${instructionId}`,
      "generated_instruction.pdf",
    );
    await c.env.RECEIPT_INSTRUCTIONS_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const db = createDb(c.env.DB);
    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const attachmentId = crypto.randomUUID();

    await this.repo.insertAttachment({
      id: attachmentId,
      instructionId,
      fileName: await resolveDocumentFileName(c.env.DB, "receiving_instruction", instructionId),
      storageType: "R2",
      attachmentR2Path: r2Path,
      fileType: "PDF",
      uploadedById: operatorId,
      uploadedAt: new Date(),
    });
    await this.repo.updateInstructionDocumentPath(instructionId, r2Path);

    // Item6 Phase6-4: 倉庫の登録済み連絡先(未登録時は倉庫マスタ.emailへフォールバック)へ、
    // 発行と同時にダウンロードページへのリンクを自動送信する。複数連絡先が登録されていれば全員へ送信する
    const contactsRepo = new WarehouseContactsRepository(c.env.DB);
    const contacts = await contactsRepo.findActiveContactsForDocument(header.warehouseId, "receipt_instruction");
    const recipientEmails =
      contacts.length > 0
        ? Array.from(
            new Set(
              contacts
                .map((ct) => ct.email?.trim().toLowerCase())
                .filter((email): email is string => !!email),
            ),
          )
        : warehouse.email
          ? [warehouse.email.trim().toLowerCase()]
          : [];

    if (recipientEmails.length > 0) {
      const siteUrl = String((systemConfig as any).site_url || "http://localhost:3000").replace(
        /\/$/,
        "",
      );
      const downloadLink = `${siteUrl}/receipt-instruction-download?instructionId=${encodeURIComponent(instructionId)}&attachmentId=${encodeURIComponent(attachmentId)}`;
      for (const recipientEmail of recipientEmails) {
        c.executionCtx.waitUntil(
          enqueueNotification({
            dbLog: c.env.DB_LOG,
            category: "receipt_instruction_issued",
            documentId: instructionId,
            recipientTo: recipientEmail,
            subject: "【入荷指示書発行】ダウンロードのご案内",
            body: [
              `${warehouse.name} 御中`,
              "",
              "入荷指示書を発行いたしました。以下のリンクよりダウンロードをお願いいたします。",
              downloadLink,
              "(リンクを開いた後、本メール宛に送信される確認コードの入力が必要です)",
            ].join("\n"),
          }),
        );
      }
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "GENERATE_RECEIPT_INSTRUCTION_PDF", RESOURCE_KEY, instructionId, null, {
        attachmentId,
        warehouseId: header.warehouseId,
        partnerId: header.partnerId,
        ...(uploadedBy ? { generatedIn: "browser", uploadedBy: uploadedBy.userId, pdfBytes: uploadedBy.size } : {}),
      }),
    );

    return { success: true, message: "入荷指示書PDFを生成しました", attachmentId };
  }
}
