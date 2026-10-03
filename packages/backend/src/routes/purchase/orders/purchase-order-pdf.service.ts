import { Context } from "hono";
import { PurchaseOrderRepository } from "./purchase-order.repository";
import { RESOURCE_KEY } from "./purchase-order-constants";
import { generateDocumentPDF } from "../../../utils/pdfGenerator";
import { DEFAULT_ITEM_NAME, DEFAULT_PAYMENT_TERMS } from "../../../platform/documents/document-defaults";
import { renderLayoutToPdf } from "../../../platform/report-templates/render-layout-pdf";
import { resolvePurchaseOrderPlaceholders } from "../../../platform/report-templates/resolve-purchase-order-placeholders";
import { computeQuoteAmountBreakdown } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { CompiledLayout } from "../../../platform/report-templates/types";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { toTaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";

// sales-order-pdf.service.ts/quote-pdf.service.tsと同じ方針(標準レイアウト・カスタムExcel
// テンプレート両対応)。templateType: "ORDER"はutils/pdfGenerator.tsのコメント通りItem9の
// 自社発注(発注書)専用に予約済みで、reportLayouts.jsonに「御発注書」レイアウトが定義済みのため
// 新規レイアウト設計は不要
export class PurchaseOrderPdfService {
  private repo: PurchaseOrderRepository;

  constructor(repo: PurchaseOrderRepository) {
    this.repo = repo;
  }

  async generatePdf(c: Context, id: string) {
    const rows = await this.repo.findOrderWithPartner(id);
    if (rows.length === 0) return null;

    const hData = rows[0].orders;
    const partnerMaster = rows[0].partners;
    const userMaster = rows[0].users;

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const resolvedPartnerName = partnerMaster?.name || "ご担当者";

    const items = await this.repo.findOrderItems(id);

    let staffName = "購買担当者";
    const staffDepartment = hData.companyDepartment || "";

    if (userMaster?.name) {
      staffName = userMaster.name;
    } else if (hData.purchasePersonEmployeeNumber) {
      const userRecord = await this.repo.findUserByEmployeeNumber(
        hData.purchasePersonEmployeeNumber,
      );
      if (userRecord && userRecord.name) staffName = userRecord.name;
    }

    const [fontRes, logoRes, sealRes] = await Promise.all([
      c.env.SYSTEM_BUCKET.get("fonts/company_fonts.ttf"),
      c.env.SYSTEM_BUCKET.get("company/company_logo.png"),
      c.env.SYSTEM_BUCKET.get("company/company_seal.png"),
    ]);

    if (!fontRes) throw new Error("日本語フォントファイルがR2に見つかりません");

    const fontBuffer = await fontRes.arrayBuffer();
    const logoBuffer = logoRes ? await logoRes.arrayBuffer() : null;
    const sealBuffer = sealRes ? await sealRes.arrayBuffer() : null;

    const taxCategoryRates = await this.repo.findTaxCategoryRates();
    const unitNames = await this.repo.findUnitNames();
    // order_itemsはquote_items/sales_order_itemsと異なりamount列を持たないため都度算出する
    const breakdownItems = items.map((i) => ({
      amount: i.quantity * i.unitPrice,
      taxCategoryCode: i.taxCategoryCode,
    }));
    const { discountTotal, breakdown: taxBreakdown } = computeQuoteAmountBreakdown(breakdownItems, taxCategoryRates, toTaxRoundingMode(systemConfig.tax_rounding_mode));

    const pdfData = {
      templateType: "ORDER" as const,
      code: hData.id,
      date: hData.orderDate ? new Date(hData.orderDate).toISOString().split("T")[0] : "",
      customerName: resolvedPartnerName,
      totalAmount: hData.totalAmount,
      taxAmount: hData.taxAmount,
      memo: hData.memo,
      quoteTitle: hData.title || "発注の件",
      deliveryDate: hData.deliveryDate || "",
      deliveryPlace: hData.deliveryPlace || "貴社指定場所",
      paymentTerms: hData.paymentTerms || DEFAULT_PAYMENT_TERMS,
      salesPersonName: staffName,
      salesPersonDepartment: staffDepartment,
      customCompanyName: hData.companyName || systemConfig.company_name || "",
      customCompanyZip: systemConfig.company_zip || "",
      customCompanyAddress: hData.companyAddress || systemConfig.company_address || "",
      customCompanyTel: hData.companyTel || systemConfig.company_tel || "",
      customCompanyFax: hData.companyFax || systemConfig.company_fax || "",
      companyInvoiceNo: systemConfig.company_invoice_registration_no
        ? String(systemConfig.company_invoice_registration_no)
        : "",
      items: items.map((i) => ({
        itemName: i.itemName || DEFAULT_ITEM_NAME,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      discountTotal,
      taxBreakdown,
    };

    const customPdf = await this.tryRenderFromCustomTemplate(
      c,
      hData,
      items,
      resolvedPartnerName,
      staffName,
      systemConfig,
      fontBuffer,
      taxCategoryRates,
      unitNames,
    );

    const pdfBinary =
      customPdf ?? (await generateDocumentPDF(pdfData, { fontBuffer, logoBuffer, sealBuffer }));

    const r2Path = generateAttachmentKey(`purchase-orders/${id}`, "generated_order.pdf");
    await c.env.PURCHASE_ORDERS_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const fallbackId = await this.repo.getFallbackOperatorId(c);
    const actualUserId = hData.updatedBy || fallbackId;
    const attachmentId = crypto.randomUUID();

    await this.repo.insertOrderAttachment({
      id: attachmentId,
      orderId: id,
      orderItemId: null,
      fileName: await resolveDocumentFileName(c.env.DB, "purchase_order", id),
      storageType: "R2",
      attachmentR2Path: r2Path,
      externalUrl: null,
      fileType: "PDF",
      uploadedById: actualUserId,
      uploadedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "GENERATE_PURCHASE_ORDER_PDF", RESOURCE_KEY, id, hData, {
        attachmentId,
        fileName: await resolveDocumentFileName(c.env.DB, "purchase_order", id),
        totalAmount: hData.totalAmount,
        partnerName: resolvedPartnerName,
      }),
    );

    return {
      success: true,
      message: "画面編集内容を反映したPDFを発注履歴に生成しました",
    };
  }

  private async tryRenderFromCustomTemplate(
    c: Context,
    hData: any,
    items: any[],
    partnerName: string,
    staffName: string,
    systemConfig: Record<string, unknown>,
    fontBuffer: ArrayBuffer,
    taxCategoryRates: Map<string, number>,
    unitNames: Map<string, string>,
  ): Promise<Uint8Array | null> {
    try {
      const mailTemplate = await this.repo.findMailTemplate("purchase_order");
      if (!mailTemplate || mailTemplate.reportLayoutStatus !== "READY" || !mailTemplate.reportLayoutPath) {
        return null;
      }

      const layoutObj = await c.env.SYSTEM_BUCKET.get(mailTemplate.reportLayoutPath);
      if (!layoutObj) return null;

      const layout: CompiledLayout = JSON.parse(await layoutObj.text());

      const { values, items: resolvedItems } = resolvePurchaseOrderPlaceholders({
        order: hData,
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
        "[PurchaseOrderPdf] カスタムテンプレートでの生成に失敗、既定のレイアウトへフォールバックします:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}
