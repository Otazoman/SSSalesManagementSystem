import { Context } from "hono";
import { Env } from "../../../types/env";
import { ShipmentInstructionsRepository } from "./shipment-instructions.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { WarehouseContactsRepository } from "../../master/warehouse-contacts/warehouse-contacts.repository";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { ProductsRepository } from "../../master/products/products.repository";
import { UnitsRepository } from "../../master/units/units.repository";
import { UserRepository } from "../../admin/users/user.repository";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import {
  generateInstructionPdf,
  InstructionPdfData,
} from "../../../platform/report-templates/generate-instruction-pdf";
import { tryRenderInstructionPdfFromCustomTemplate } from "../../../platform/report-templates/try-render-instruction-pdf";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { createDb } from "../../../platform/db/create-db";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { todayJst } from "../../../platform/date/format-jst-date";

const RESOURCE_KEY = "inventory_instructions";
const REPORT_TEMPLATE_CATEGORY = "shipping_instruction";

// Item6 Phase6-4: 出荷指示書PDFの生成。quote-pdf.service.tsと同じくオンデマンドAPI
// (承認確定後、画面から明示的に叩く方式)。承認機能OFF時はUNAPPROVED→APPROVED即時遷移直後から
// 発行可能、ON時は承認確定後(status==="APPROVED")にのみ発行可能とする
export class ShipmentInstructionPdfService {
  constructor(private repo: ShipmentInstructionsRepository) {}

  async generatePdf(c: Context<{ Bindings: Env }>, instructionId: string) {
    const header = await this.repo.findHeaderById(instructionId);
    if (!header) throw new NotFoundError("対象の出荷指示が見つかりません");
    if (header.status === "UNAPPROVED" || header.status === "REMANDED") {
      throw new BadRequestError(
        "指示書PDFは発行済み(承認確定後)の出荷指示のみ生成できます",
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

    const [fontRes, logoRes, sealRes] = await Promise.all([
      c.env.SYSTEM_BUCKET.get("fonts/company_fonts.ttf"),
      c.env.SYSTEM_BUCKET.get("company/company_logo.png"),
      c.env.SYSTEM_BUCKET.get("company/company_seal.png"),
    ]);
    if (!fontRes) throw new Error("日本語フォントファイルがR2に見つかりません");
    const fontBuffer = await fontRes.arrayBuffer();
    const logoBuffer = logoRes ? await logoRes.arrayBuffer() : null;
    const sealBuffer = sealRes ? await sealRes.arrayBuffer() : null;

    const instructionData: InstructionPdfData = {
      documentTitle: "出荷指示書",
      code: instructionId,
      date: todayJst(),
      recipientLabel: "出荷先(外部倉庫)",
      recipientName: warehouse.name,
      recipientAddress: warehouse.address,
      recipientTel: warehouse.phoneNumber,
      partnerLabel: "得意先",
      partnerName: partner.name,
      scheduledDateLabel: "出荷予定日",
      scheduledDate: new Date(header.instructedShipDate).toISOString().slice(0, 10),
      companyName: (systemConfig as any).company_name || "",
      companyZip: (systemConfig as any).company_zip || "",
      companyAddress: (systemConfig as any).company_address || "",
      companyTel: (systemConfig as any).company_tel || "",
      companyFax: (systemConfig as any).company_fax || "",
      memo: header.memo,
      staffName: staffUser?.name || header.createdBy,
      items: itemsWithNames,
      // Item6 Phase6-4追加: 「どこに対して出荷するか」(納品先=得意先)を明示する
      deliveryAddressee: `${partner.name} 御中`,
      deliveryLocation: partner.address || null,
      deliveryPhone: partner.phone || null,
    };

    const customPdf = await tryRenderInstructionPdfFromCustomTemplate(
      c.env,
      REPORT_TEMPLATE_CATEGORY,
      instructionData,
      fontBuffer,
    );
    const pdfBinary =
      customPdf ??
      (await generateInstructionPdf(instructionData, { fontBuffer, logoBuffer, sealBuffer }));

    const r2Path = generateAttachmentKey(
      `shipment-instructions/${instructionId}`,
      "generated_instruction.pdf",
    );
    await c.env.SHIPMENT_INSTRUCTIONS_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const db = createDb(c.env.DB);
    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const attachmentId = crypto.randomUUID();

    await this.repo.insertAttachment({
      id: attachmentId,
      instructionId,
      fileName: await resolveDocumentFileName(c.env.DB, "shipping_instruction", instructionId),
      storageType: "R2",
      attachmentR2Path: r2Path,
      fileType: "PDF",
      uploadedById: operatorId,
      uploadedAt: new Date(),
    });
    await this.repo.updateInstructionDocumentPath(instructionId, r2Path);

    // Item6 Phase6-4: 倉庫の登録済み連絡先(未登録時は倉庫マスタ.emailへフォールバック)へ、
    // 発行と同時にダウンロードページへのリンクを自動送信する。見積のように送信操作を
    // 別途挟まない(生成完了時点で自動送信するのが自然)。複数連絡先が登録されていれば全員へ送信する
    const contactsRepo = new WarehouseContactsRepository(c.env.DB);
    const contacts = await contactsRepo.findActiveContactsForDocument(header.warehouseId, "shipment_instruction");
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
      const downloadLink = `${siteUrl}/shipment-instruction-download?instructionId=${encodeURIComponent(instructionId)}&attachmentId=${encodeURIComponent(attachmentId)}`;
      for (const recipientEmail of recipientEmails) {
        c.executionCtx.waitUntil(
          enqueueNotification({
            dbLog: c.env.DB_LOG,
            category: "shipment_instruction_issued",
            documentId: instructionId,
            recipientTo: recipientEmail,
            subject: "【出荷指示書発行】ダウンロードのご案内",
            body: [
              `${warehouse.name} 御中`,
              "",
              "出荷指示書を発行いたしました。以下のリンクよりダウンロードをお願いいたします。",
              downloadLink,
              "(リンクを開いた後、本メール宛に送信される確認コードの入力が必要です)",
            ].join("\n"),
          }),
        );
      }
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "GENERATE_SHIPMENT_INSTRUCTION_PDF", RESOURCE_KEY, instructionId, null, {
        attachmentId,
        warehouseId: header.warehouseId,
        partnerId: header.partnerId,
      }),
    );

    return { success: true, message: "出荷指示書PDFを生成しました", attachmentId };
  }
}
