import { Context } from "hono";
import { Env } from "../../../types/env";
import { ReceiptsRepository } from "./receipts.repository";
import { ProductsRepository } from "../../master/products/products.repository";
import { generateDocumentPDF, PDFInvoiceData } from "../../../utils/pdfGenerator";
import { renderLayoutToPdf } from "../../../platform/report-templates/render-layout-pdf";
import { resolveAcceptanceInspectionPlaceholders } from "../../../platform/report-templates/resolve-acceptance-inspection-placeholders";
import { computeQuoteAmountBreakdown } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { CompiledLayout } from "../../../platform/report-templates/types";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { createDb } from "../../../platform/db/create-db";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { toTaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";
import { todayJst } from "../../../platform/date/format-jst-date";

const RESOURCE_KEY = "inventory_stock";

// 検収書発行(Item9): 発注書のレイアウト・発行方式(オンデマンド発行+複数バージョン管理の
// 添付テーブル)を踏襲する。purchase-order-pdf.service.tsと同じ構成だが、item_receipt_itemsは
// order_itemsと異なりitemName/unitPrice/taxCategoryCodeを持たないため、findItemsWithPricingByHeaderId
// (orderItemId経由のleftJoin)+ProductsRepositoryでの品名解決を組み合わせる(delivery-note-pdf.service.ts
// と同じ方針)
export class AcceptanceInspectionPdfService {
  constructor(private repo: ReceiptsRepository) {}

  async generatePdf(c: Context<{ Bindings: Env }>, id: string) {
    const rows = await this.repo.findReceiptWithPartner(id);
    if (rows.length === 0) return null;

    const header = rows[0].header;
    const partner = rows[0].partner;
    if (header.status !== "APPROVED") {
      throw new BadRequestError("検収書は入庫が確定(承認済み)している場合のみ発行できます");
    }

    const items = await this.repo.findItemsWithPricingByHeaderId(id);
    if (items.length === 0) throw new NotFoundError("対象の入庫明細が見つかりません");

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const resolvedPartnerName = partner?.name || "ご担当者";

    const db = createDb(c.env.DB);
    const fallbackId = await resolveOperatorEmployeeNumber(c, db);
    const staffName = header.createdBy || fallbackId;

    const [fontRes, logoRes, sealRes] = await Promise.all([
      c.env.SYSTEM_BUCKET.get("fonts/company_fonts.ttf"),
      c.env.SYSTEM_BUCKET.get("company/company_logo.png"),
      c.env.SYSTEM_BUCKET.get("company/company_seal.png"),
    ]);
    if (!fontRes) throw new Error("日本語フォントファイルがR2に見つかりません");

    const fontBuffer = await fontRes.arrayBuffer();
    const logoBuffer = logoRes ? await logoRes.arrayBuffer() : null;
    const sealBuffer = sealRes ? await sealRes.arrayBuffer() : null;

    const productsRepo = new ProductsRepository(c.env.DB);
    const itemsWithNames = await Promise.all(
      items.map(async (item: any) => {
        const product = await productsRepo.findProductById(item.itemId);
        return {
          itemName: product?.name || item.itemId,
          lotNumber: item.lotNumber === "NONE" ? "" : item.lotNumber,
          quantity: item.receivedQuantity,
          unitPrice: item.unitPrice ?? null,
          unitCode: item.unitCode ?? null,
          taxCategoryCode: item.taxCategoryCode ?? null,
        };
      }),
    );

    const taxCategoryRates = await this.repo.findTaxCategoryRates();
    const unitNames = await this.repo.findUnitNames();
    const breakdownItems = itemsWithNames.map((i) => ({
      amount: (i.unitPrice ?? 0) * i.quantity,
      taxCategoryCode: i.taxCategoryCode,
    }));
    const { subtotalBeforeDiscount, discountTotal, breakdown } = computeQuoteAmountBreakdown(breakdownItems, taxCategoryRates, toTaxRoundingMode(systemConfig.tax_rounding_mode));
    const taxAmount = breakdown.rate10.tax + breakdown.rate8.tax + breakdown.rate0.tax;
    const totalAmount = subtotalBeforeDiscount + discountTotal + taxAmount;

    const pdfData: PDFInvoiceData = {
      templateType: "ACCEPTANCE",
      code: header.id,
      date: todayJst(),
      customCompanyName: systemConfig.company_name || "",
      customCompanyZip: systemConfig.company_zip || "",
      customCompanyAddress: systemConfig.company_address || "",
      customCompanyTel: systemConfig.company_tel || "",
      customCompanyFax: systemConfig.company_fax || "",
      customerName: resolvedPartnerName,
      totalAmount,
      taxAmount,
      memo: header.memo,
      deliveryDate: new Date(header.receivedDate).toISOString().slice(0, 10),
      purchaseOrderNumber: header.orderId || "",
      salesPersonName: staffName,
      companyInvoiceNo: systemConfig.company_invoice_registration_no
        ? String(systemConfig.company_invoice_registration_no)
        : "",
      items: itemsWithNames.map((i) => ({
        itemName: i.lotNumber ? `${i.itemName}(ロット:${i.lotNumber})` : i.itemName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      discountTotal,
      taxBreakdown: breakdown,
    };

    const customPdf = await this.tryRenderFromCustomTemplate(
      c,
      header,
      itemsWithNames,
      resolvedPartnerName,
      staffName,
      systemConfig,
      fontBuffer,
      taxCategoryRates,
      unitNames,
    );

    const pdfBinary = customPdf ?? (await generateDocumentPDF(pdfData, { fontBuffer, logoBuffer, sealBuffer }));

    const r2Path = generateAttachmentKey(`inventory-documents/acceptance-inspections/${id}`, "acceptance_inspection.pdf");
    await c.env.ACCEPTANCE_INSPECTIONS_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const attachmentId = crypto.randomUUID();
    await this.repo.insertReceiptAttachment({
      id: attachmentId,
      receiptHeaderId: id,
      receiptItemId: null,
      fileName: await resolveDocumentFileName(c.env.DB, "acceptance_inspection", id),
      storageType: "R2",
      attachmentR2Path: r2Path,
      externalUrl: null,
      fileType: "PDF",
      uploadedById: fallbackId,
      uploadedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "GENERATE_ACCEPTANCE_INSPECTION_PDF", RESOURCE_KEY, id, header, {
        attachmentId,
        fileName: await resolveDocumentFileName(c.env.DB, "acceptance_inspection", id),
        totalAmount,
        partnerName: resolvedPartnerName,
      }),
    );

    return {
      success: true,
      message: "検収書PDFを生成しました",
    };
  }

  private async tryRenderFromCustomTemplate(
    c: Context<{ Bindings: Env }>,
    header: any,
    items: any[],
    partnerName: string,
    staffName: string,
    systemConfig: Record<string, unknown>,
    fontBuffer: ArrayBuffer,
    taxCategoryRates: Map<string, number>,
    unitNames: Map<string, string>,
  ): Promise<Uint8Array | null> {
    try {
      const mailTemplate = await this.repo.findMailTemplate("acceptance_inspection");
      if (!mailTemplate || mailTemplate.reportLayoutStatus !== "READY" || !mailTemplate.reportLayoutPath) {
        return null;
      }

      const layoutObj = await c.env.SYSTEM_BUCKET.get(mailTemplate.reportLayoutPath);
      if (!layoutObj) return null;

      const layout: CompiledLayout = JSON.parse(await layoutObj.text());

      const { values, items: resolvedItems } = resolveAcceptanceInspectionPlaceholders({
        header,
        partnerName,
        items,
        staffName,
        systemConfig,
        taxCategoryRates,
        taxRoundingMode: toTaxRoundingMode(systemConfig.tax_rounding_mode),
        unitNames,
      });

      return await renderLayoutToPdf(layout, values, resolvedItems, fontBuffer);
    } catch (err) {
      console.error(
        "[AcceptanceInspectionPdf] カスタムテンプレートでの生成に失敗、既定のレイアウトへフォールバックします:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}
