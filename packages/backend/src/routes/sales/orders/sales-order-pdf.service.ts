import { Context } from "hono";
import { SalesOrderRepository } from "./sales-order.repository";
import { RESOURCE_KEY } from "./sales-order-constants";
import { type ReportPdfSource } from "report-renderer";
import { DEFAULT_ITEM_NAME, DEFAULT_PAYMENT_TERMS } from "../../../platform/documents/document-defaults";
import { resolveOrderPlaceholders } from "../../../platform/report-templates/resolve-order-placeholders";
import { computeQuoteAmountBreakdown } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { loadCustomLayoutSource } from "../../../platform/report-templates/load-custom-layout";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { toTaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";

// Item7: quote-pdf.service.tsと同じ方針(標準レイアウト・カスタムExcelテンプレート両対応)。
// 受注は見積と同じく金額・税区分を持つため、Item6の指示書系(数量のみ)ではなくこちらの
// パターンを踏襲する。R2は追加要望L-3-aで受注専用のSALES_ORDERS_BUCKETへ分離した(既存ファイルは旧QUATES_BUCKETへフォールバック)
export class SalesOrderPdfService {
  private repo: SalesOrderRepository;

  constructor(repo: SalesOrderRepository) {
    this.repo = repo;
  }

  // PERF-07 B-3: PDF を作るためのデータ(GET /:id/pdf-source)。受注が無ければ null。
  // withLayout が false の時(受け取った PDF の保存の時)は、Excel テンプレートのレイアウトを読まない
  async buildPdfSource(c: Context, id: string, withLayout = true) {
    const rows = await this.repo.findOrderWithPartner(id);
    if (rows.length === 0) return null;

    const hData = rows[0].salesOrders;
    const partnerMaster = rows[0].partners;
    const userMaster = rows[0].users;

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const resolvedPartnerName = partnerMaster?.name || "ご担当者";

    const items = await this.repo.findOrderItems(id);

    let staffName = "営業部 担当者";
    let staffDepartment = (hData as any).companyDepartment || (rows[0] as any)?.departmentName || "";

    if (userMaster?.name) {
      staffName = userMaster.name;
    } else if ((hData as any).salesPersonEmployeeNumber) {
      const userRecord = await this.repo.findUserByEmployeeNumber(
        (hData as any).salesPersonEmployeeNumber,
      );
      if (userRecord && userRecord.name) staffName = userRecord.name;
    }

    const taxCategoryRates = await this.repo.findTaxCategoryRates();
    const unitNames = await this.repo.findUnitNames();
    const { discountTotal, breakdown: taxBreakdown } = computeQuoteAmountBreakdown(items, taxCategoryRates, toTaxRoundingMode(systemConfig.tax_rounding_mode));

    const pdfData = {
      templateType: "ORDER_ACKNOWLEDGMENT" as const,
      code: hData.id,
      date: hData.orderDate ? new Date(hData.orderDate).toISOString().split("T")[0] : "",
      customerName: resolvedPartnerName,
      totalAmount: hData.totalAmount,
      taxAmount: hData.taxAmount,
      memo: hData.memo,
      quoteTitle: hData.title || "ご注文の件",
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
        deliveryDate: i.deliveryDate,
      })),
      discountTotal,
      taxBreakdown,
    };

    // 💡 mail-settings.service.tsのINITIAL_TEMPLATESで予約されているid("order_acknowledgement")と
    // 一致させる必要がある("sales_order"ではない。admin/mail-settings画面で管理される帳票種別idのため)
    const customLayout = !withLayout
      ? null
      : await loadCustomLayoutSource(c.env, "order_acknowledgement", () =>
          resolveOrderPlaceholders({
            order: hData,
            partnerName: resolvedPartnerName,
            items,
            staffName,
            systemConfig,
            taxCategoryRates,
            taxRoundingMode: toTaxRoundingMode(systemConfig.tax_rounding_mode),
            unitNames,
          }),
        );

    const source: ReportPdfSource = {
      documentType: "order_acknowledgement",
      customLayout,
      fallback: { kind: "document", data: pdfData },
    };
    return { source, hData, resolvedPartnerName };
  }

  // PERF-07 B-4: できた PDF を保存し、受注履歴への記録・監査ログを残す(generate-pdf と、ブラウザから受け取った PDF の両方)
  async storePdf(
    c: Context,
    id: string,
    pdfBinary: Uint8Array,
    built: { hData: { updatedBy: string | null; totalAmount: number } & Record<string, any>; resolvedPartnerName: string },
    uploadedBy?: { userId: string; size: number },
  ) {
    const { hData, resolvedPartnerName } = built;
    const r2Path = generateAttachmentKey(`orders/${id}`, "generated_order.pdf");
    await c.env.SALES_ORDERS_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const fallbackId = await this.repo.getFallbackOperatorId(c);
    const actualUserId = hData.updatedBy || fallbackId;
    const attachmentId = crypto.randomUUID();

    await this.repo.insertOrderAttachment({
      id: attachmentId,
      salesOrderId: id,
      fileName: await resolveDocumentFileName(c.env.DB, "order_acknowledgement", id),
      storageType: "R2",
      attachmentR2Path: r2Path,
      externalUrl: null,
      fileType: "PDF",
      uploadedById: actualUserId,
      uploadedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "GENERATE_SALES_ORDER_PDF", RESOURCE_KEY, id, hData, {
        attachmentId,
        fileName: await resolveDocumentFileName(c.env.DB, "order_acknowledgement", id),
        totalAmount: hData.totalAmount,
        customerName: resolvedPartnerName,
        ...(uploadedBy ? { generatedIn: "browser", uploadedBy: uploadedBy.userId, pdfBytes: uploadedBy.size } : {}),
      }),
    );

    return {
      success: true,
      message: "画面編集内容を反映したPDFを受注履歴に生成しました",
    };
  }
}
