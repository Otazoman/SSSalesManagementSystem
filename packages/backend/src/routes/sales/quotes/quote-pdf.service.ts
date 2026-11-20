import { Context } from "hono";
import { QuoteRepository } from "./quote.repository";
import { RESOURCE_KEY } from "./quote-constants";
import { type ReportPdfSource } from "report-renderer";
import { DEFAULT_ITEM_NAME, DEFAULT_PAYMENT_TERMS } from "../../../platform/documents/document-defaults";
import { resolveQuotePlaceholders } from "../../../platform/report-templates/resolve-quote-placeholders";
import { computeQuoteAmountBreakdown } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { loadCustomLayoutSource } from "../../../platform/report-templates/load-custom-layout";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { toTaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";

// Item4-f: quote.service.tsから分割。PDF生成(標準レイアウト・カスタムExcelテンプレート両対応)を担当
export class QuotePdfService {
  private repo: QuoteRepository;

  constructor(repo: QuoteRepository) {
    this.repo = repo;
  }

  // PERF-07 B-3: PDF を作るためのデータ(GET /:id/pdf-source。ブラウザが renderReportPdf で描く)。見積が無ければ null
  // withLayout が false の時(受け取った PDF の保存の時)は、Excel テンプレートのレイアウトを読まない
  async buildPdfSource(
    c: Context,
    id: string,
    options: { includeOrderForm?: boolean; withLayout?: boolean } = {},
  ) {
    // findQuoteWithCustomer -> findQuoteWithPartner
    const rows = await this.repo.findQuoteWithPartner(id);
    if (rows.length === 0) return null;

    const hData = rows[0].quotes;
    const partnerMaster = rows[0].partners; // customers -> partners
    const userMaster = rows[0].users;

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const resolvedPartnerName = partnerMaster?.name || "ご担当者";

    const items = await this.repo.findQuoteItems(id);

    let staffName = "営業部 担当者";
    // 💡 型エラー回避のため (rows[0] as any)?.departmentName とキャスト指定
    let staffDepartment =
      (hData as any).companyDepartment ||
      (rows[0] as any)?.departmentName ||
      "";

    if (userMaster?.name) {
      staffName = userMaster.name;
    } else if ((hData as any).salesPersonEmployeeNumber) {
      // Item4-d: 自社担当者はsalesPersonEmployeeNumber(employeeNumber)で保持
      const userRecord = await this.repo.findUserByEmployeeNumber(
        (hData as any).salesPersonEmployeeNumber,
      );
      if (userRecord && userRecord.name) staffName = userRecord.name;
    }

    const taxCategoryRates = await this.repo.findTaxCategoryRates();
    const unitNames = await this.repo.findUnitNames();
    const { discountTotal, breakdown: taxBreakdown } = computeQuoteAmountBreakdown(items, taxCategoryRates, toTaxRoundingMode(systemConfig.tax_rounding_mode));

    const pdfData = {
      templateType: "QUOTATION" as const,
      code: hData.id,
      date: hData.quoteDate
        ? new Date(hData.quoteDate).toISOString().split("T")[0]
        : "",
      customerName: resolvedPartnerName,
      totalAmount: hData.totalAmount,
      taxAmount: hData.taxAmount,
      memo: hData.memo,
      quoteTitle: hData.title || "御見積の件",
      deliveryDate: hData.deliveryDate || "注文確定後、約2週間でお届け",
      deliveryPlace: hData.deliveryPlace || "貴社指定場所",
      paymentTerms: hData.paymentTerms || DEFAULT_PAYMENT_TERMS,
      expiryDate: hData.validUntil
        ? new Date(hData.validUntil).toISOString().split("T")[0]
        : "発行から1ヶ月間",
      salesPersonName: staffName,
      salesPersonDepartment: staffDepartment,
      customCompanyName: hData.companyName || systemConfig.company_name || "",
      customCompanyZip: systemConfig.company_zip || "",
      customCompanyAddress:
        hData.companyAddress || systemConfig.company_address || "",
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

    // Item4-a Stage2: 帳票Excelテンプレートがコンパイル済み(reportLayoutStatus==='READY')であれば
    // layout.json駆動でPDFを生成する。テンプレート未登録・未コンパイル・描画失敗時は既定のレイアウトで描く
    const customLayout = options.withLayout === false ? null : await loadCustomLayoutSource(c.env, "sales_quote", () =>
      resolveQuotePlaceholders({
        quote: hData,
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
      documentType: "sales_quote",
      customLayout,
      fallback: { kind: "document", data: pdfData },
      // REQ-002: ご発注書は、カスタムの Excel テンプレートを使っている場合も固定レイアウト(reportLayouts.json の CUSTOMER_ORDER_FORM)。
      // 宛先は自社(発行元の会社名)、右上はお客様の記入・押印欄にし、明細・金額・条件は見積書と同じにする
      appendDocuments: options.includeOrderForm
        ? [
            {
              ...pdfData,
              templateType: "CUSTOMER_ORDER_FORM",
              customerName: pdfData.customCompanyName,
              date: "",
              sourceQuoteNumber: hData.id,
            },
          ]
        : [],
    };
    return { source, hData, resolvedPartnerName };
  }

  // PERF-07 B-4: できた PDF を保存し、見積履歴への記録・監査ログを残す(generate-pdf と、ブラウザから受け取った PDF の両方)
  async storePdf(
    c: Context,
    id: string,
    pdfBinary: Uint8Array,
    built: { hData: { updatedBy: string | null; totalAmount: number } & Record<string, any>; resolvedPartnerName: string },
    uploadedBy?: { userId: string; size: number },
  ) {
    const { hData, resolvedPartnerName } = built;
    const r2Path = generateAttachmentKey(`quotes/${id}`, "generated_quote.pdf");
    await c.env.QUATES_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const fallbackId = await this.repo.getFallbackOperatorId(c);
    const actualUserId = hData.updatedBy || fallbackId;
    const attachmentId = crypto.randomUUID();

    await this.repo.insertQuoteAttachment({
      id: attachmentId,
      quoteId: id,
      fileName: await resolveDocumentFileName(c.env.DB, "sales_quote", id),
      storageType: "R2",
      attachmentR2Path: r2Path,
      externalUrl: null,
      fileType: "PDF",
      uploadedById: actualUserId,
      uploadedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "GENERATE_QUOTE_PDF", RESOURCE_KEY, id, hData, {
      attachmentId,
      fileName: await resolveDocumentFileName(c.env.DB, "sales_quote", id),
      totalAmount: hData.totalAmount,
      customerName: resolvedPartnerName,
      ...(uploadedBy ? { generatedIn: "browser", uploadedBy: uploadedBy.userId, pdfBytes: uploadedBy.size } : {}),
    }),
    );

    return {
      success: true,
      message: "画面編集内容を反映したPDFを見積履歴に生成しました",
    };
  }
}
