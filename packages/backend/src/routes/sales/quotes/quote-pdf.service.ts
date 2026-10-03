import { Context } from "hono";
import { QuoteRepository } from "./quote.repository";
import { RESOURCE_KEY } from "./quote-constants";
import { generateDocumentPDF } from "../../../utils/pdfGenerator";
import { DEFAULT_ITEM_NAME, DEFAULT_PAYMENT_TERMS } from "../../../platform/documents/document-defaults";
import { renderLayoutToPdf } from "../../../platform/report-templates/render-layout-pdf";
import { resolveQuotePlaceholders } from "../../../platform/report-templates/resolve-quote-placeholders";
import { computeQuoteAmountBreakdown } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { CompiledLayout } from "../../../platform/report-templates/types";
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

  // 8. PDF 生成
  async generatePdf(c: Context, id: string) {
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
      customPdf ??
      (await generateDocumentPDF(pdfData, {
        fontBuffer,
        logoBuffer,
        sealBuffer,
      }));

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
    }),
    );

    return {
      success: true,
      message: "画面編集内容を反映したPDFを見積履歴に生成しました",
    };
  }

  // Item4-a Stage2: 帳票Excelテンプレートがコンパイル済み(reportLayoutStatus==='READY')であれば
  // layout.json駆動でPDFを生成する。テンプレート未登録・未コンパイル・描画失敗時はnullを返し、
  // 呼び出し元は既存のreportLayouts.json+pdf-lib方式(generateDocumentPDF)へフォールバックする。
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
      const mailTemplate = await this.repo.findMailTemplate("sales_quote");
      if (
        !mailTemplate ||
        mailTemplate.reportLayoutStatus !== "READY" ||
        !mailTemplate.reportLayoutPath
      ) {
        return null;
      }

      const layoutObj = await c.env.SYSTEM_BUCKET.get(mailTemplate.reportLayoutPath);
      if (!layoutObj) return null;

      const layout: CompiledLayout = JSON.parse(await layoutObj.text());

      const { values, items: resolvedItems } = resolveQuotePlaceholders({
        quote: hData,
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
        "[QuotePdf] カスタムテンプレートでの生成に失敗、既定のレイアウトへフォールバックします:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}
