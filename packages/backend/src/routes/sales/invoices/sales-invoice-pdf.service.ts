import { Context } from "hono";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { RESOURCE_KEY } from "./sales-invoice-constants";
import { generateDocumentPDF } from "../../../utils/pdfGenerator";
import { DEFAULT_ITEM_NAME, DEFAULT_PAYMENT_TERMS } from "../../../platform/documents/document-defaults";
import { computeQuoteAmountBreakdown } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { resolveSalesRecognitionPlaceholders } from "../../../platform/report-templates/resolve-document-placeholders";
import { tryRenderDocumentPdfFromCustomTemplate } from "../../../platform/report-templates/try-render-document-pdf";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { toTaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";

// Item8: quote-pdf.service.ts/sales-order-pdf.service.tsと同じ方針だが、mail-settingsの
// テンプレートid"sales_invoice"は既に納品書(delivery-note-*.service.ts)が使用済みのため、
// 売上計上書のテンプレートは別のid"sales_recognition"(Excel)を使い、登録・コンパイル済みであれば
// それで描画する。未登録・失敗時は標準レイアウト(generateDocumentPDF)へ戻る。
// 追加要望(2026-09-16ユーザー確認済み): 正式な請求書発行は請求管理(billing)に一本化する方針とし、
// 本機能(売上計上個別のPDF)は"INVOICE"(御請求書)から"SALES_RECOGNITION"(売上計上書、
// purchase-recognition-pdf.service.tsと対称)へレイアウトを変更した。内部確認・取引先への
// 売上計上お知らせ用の非公式な書類であり、正式な請求書ではない
export class SalesInvoicePdfService {
  private repo: SalesInvoiceRepository;

  constructor(repo: SalesInvoiceRepository) {
    this.repo = repo;
  }

  async generatePdf(c: Context, id: string) {
    const rows = await this.repo.findInvoiceWithPartner(id);
    if (rows.length === 0) return null;

    const hData = rows[0].salesInvoices;
    const partnerMaster = rows[0].partners;
    const userMaster = rows[0].users;

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const resolvedPartnerName = partnerMaster?.name || "ご担当者";

    const items = await this.repo.findInvoiceItems(id);

    let staffName = "営業部 担当者";
    if (userMaster?.name) {
      staffName = userMaster.name;
    } else if (hData.salesPersonEmployeeNumber) {
      const userRecord = await this.repo.findUserByEmployeeNumber(hData.salesPersonEmployeeNumber);
      if (userRecord?.name) staffName = userRecord.name;
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
    const { discountTotal, breakdown: taxBreakdown } = computeQuoteAmountBreakdown(items, taxCategoryRates, toTaxRoundingMode(systemConfig.tax_rounding_mode));

    const pdfData = {
      templateType: "SALES_RECOGNITION" as const,
      code: hData.id,
      date: hData.invoiceDate ? new Date(hData.invoiceDate).toISOString().split("T")[0] : "",
      customerName: resolvedPartnerName,
      totalAmount: hData.totalAmount,
      taxAmount: hData.taxAmount,
      memo: hData.memo,
      quoteTitle: hData.title || "売上計上の件",
      paymentTerms: hData.paymentTerms || DEFAULT_PAYMENT_TERMS,
      salesPersonName: staffName,
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

    const unitNames = await this.repo.findUnitNames();
    const customPdf = await tryRenderDocumentPdfFromCustomTemplate(
      c.env,
      "sales_recognition",
      () =>
        resolveSalesRecognitionPlaceholders({
          salesNo: hData.id,
          salesDate: hData.invoiceDate,
          partnerName: resolvedPartnerName,
          title: hData.title,
          memo: hData.memo,
          paymentTerms: pdfData.paymentTerms,
          totalAmount: hData.totalAmount,
          taxAmount: hData.taxAmount,
          items,
          staffName,
          company: {
            name: pdfData.customCompanyName,
            zip: pdfData.customCompanyZip,
            address: pdfData.customCompanyAddress,
            tel: pdfData.customCompanyTel,
            invoiceNo: pdfData.companyInvoiceNo,
          },
          taxCategoryRates,
          taxRoundingMode: toTaxRoundingMode(systemConfig.tax_rounding_mode),
          unitNames,
        }),
      fontBuffer,
    );
    const pdfBinary =
      customPdf ?? (await generateDocumentPDF(pdfData, { fontBuffer, logoBuffer, sealBuffer }));

    const r2Path = generateAttachmentKey(`sales-invoices/${id}`, "generated_invoice.pdf");
    await c.env.SALES_INVOICES_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const fallbackId = await this.repo.getFallbackOperatorId(c);
    const actualUserId = hData.updatedBy || fallbackId;
    const attachmentId = crypto.randomUUID();

    await this.repo.insertInvoiceAttachment({
      id: attachmentId,
      salesInvoiceId: id,
      fileName: await resolveDocumentFileName(c.env.DB, "sales_recognition", id),
      storageType: "R2",
      attachmentR2Path: r2Path,
      externalUrl: null,
      fileType: "PDF",
      uploadedById: actualUserId,
      uploadedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "GENERATE_SALES_INVOICE_PDF", RESOURCE_KEY, id, hData, {
        attachmentId,
        fileName: await resolveDocumentFileName(c.env.DB, "sales_recognition", id),
        totalAmount: hData.totalAmount,
        customerName: resolvedPartnerName,
      }),
    );

    return {
      success: true,
      message: "画面編集内容を反映した売上計上書PDFを売上履歴に生成しました",
    };
  }
}
