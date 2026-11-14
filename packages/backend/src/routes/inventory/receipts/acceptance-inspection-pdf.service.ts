import { Context } from "hono";
import { Env } from "../../../types/env";
import { ReceiptsRepository } from "./receipts.repository";
import { ProductsRepository } from "../../master/products/products.repository";
import { type ReportPdfSource, type PDFInvoiceData } from "report-renderer";
import { resolveAcceptanceInspectionPlaceholders } from "../../../platform/report-templates/resolve-acceptance-inspection-placeholders";
import { computeQuoteAmountBreakdown } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { loadCustomLayoutSource } from "../../../platform/report-templates/load-custom-layout";
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

  // PERF-07 B-3: PDF を作るためのデータ(GET /:id/pdf-source)。対象が無ければ null(発行できない状態ならエラー)。
  // withLayout が false の時(受け取った PDF の保存の時)は、Excel テンプレートのレイアウトを読まない
  async buildPdfSource(c: Context<{ Bindings: Env }>, id: string, withLayout = true) {
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

    const customLayout = !withLayout
      ? null
      : await loadCustomLayoutSource(c.env, "acceptance_inspection", () =>
          resolveAcceptanceInspectionPlaceholders({
            header,
            partnerName: resolvedPartnerName,
            items: itemsWithNames,
            staffName,
            systemConfig,
            taxCategoryRates,
            taxRoundingMode: toTaxRoundingMode(systemConfig.tax_rounding_mode),
            unitNames,
          }),
        );

    const source: ReportPdfSource = {
      documentType: "acceptance_inspection",
      customLayout,
      fallback: { kind: "document", data: pdfData },
    };
    return { source, header, resolvedPartnerName, items, staffName, fallbackId, totalAmount };
  }

  // PERF-07 B-4: できた PDF を保存し、記録・監査ログを残す(generate-pdf と、ブラウザから受け取った PDF の両方)
  async storePdf(
    c: Context<{ Bindings: Env }>,
    id: string,
    pdfBinary: Uint8Array,
    built: Omit<NonNullable<Awaited<ReturnType<AcceptanceInspectionPdfService["buildPdfSource"]>>>, "source">,
    uploadedBy?: { userId: string; size: number },
  ) {
    const { header, resolvedPartnerName, items, staffName, fallbackId, totalAmount } = built;
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
        ...(uploadedBy ? { generatedIn: "browser", uploadedBy: uploadedBy.userId, pdfBytes: uploadedBy.size } : {}),
      }),
    );

    return {
      success: true,
      message: "検収書PDFを生成しました",
    };
  }
}
