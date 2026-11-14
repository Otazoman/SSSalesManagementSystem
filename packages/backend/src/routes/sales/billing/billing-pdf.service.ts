import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import { RESOURCE_KEY } from "./billing-constants";
import { type ReportPdfSource } from "report-renderer";
import { DEFAULT_ITEM_NAME, DEFAULT_PAYMENT_TERMS } from "../../../platform/documents/document-defaults";
import { computeQuoteAmountBreakdown } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { resolveBillingPlaceholders } from "../../../platform/report-templates/resolve-document-placeholders";
import { loadCustomLayoutSource } from "../../../platform/report-templates/load-custom-layout";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { buildBillingTaxLines } from "./billing-tax-lines";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { toTaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";

// Item8 Phase4: 対象のsales_invoice(群)の明細を1つのテーブルへ合算し、
// computeQuoteAmountBreakdown()で税率区分別内訳を再計算した適格請求書PDFを生成する
// (PER_TRANSACTION/PERIODICとも同じ自前生成パスを使う)。
// 帳票テンプレート(mail-settingsのid"billing_invoice"、Excel)が登録・コンパイル済みであれば
// そのテンプレートで描画し、未登録・失敗時は従来の固定レイアウト(generateDocumentPDF)へ戻る。
// 追加要望(2026-09-16ユーザー確認済み): 以前はPER_TRANSACTIONの場合、対象sales_invoice自体の
// PDF(sales-invoice-pdf.service.ts)をそのまま流用していたが、そちらのレイアウトが
// "SALES_RECOGNITION"(売上計上書)に変更されたため、請求管理からは常にここで正式な
// "INVOICE"(御請求書)レイアウトのPDFを自前生成するよう統一した
export class BillingPdfService {
  private repo: BillingRepository;

  constructor(repo: BillingRepository) {
    this.repo = repo;
  }

  // K-4-4: 再発行(保存済みPDFの再ダウンロード)。都度再生成はせず、初回発行時に
  // billingHeaders.invoicePdfR2Pathへ保存されたR2パスをそのまま返す
  async getDownloadStream(billingHeaderId: string) {
    const header = await this.repo.findHeaderById(billingHeaderId);
    if (!header) {
      throw new NotFoundError("対象の請求データが見つかりません");
    }
    if (!header.invoicePdfR2Path) {
      throw new NotFoundError("請求書PDFが未発行です。先に請求書PDFを発行してください。");
    }
    return { header };
  }

  // PERF-07 B-3: PDF を作るためのデータ(GET /:id/pdf-source)。対象が無ければ null(発行できない状態ならエラー)。
  // withLayout が false の時(受け取った PDF の保存の時)は、Excel テンプレートのレイアウトを読まない
  async buildPdfSource(c: Context, billingHeaderId: string, withLayout = true) {
    const header = await this.repo.findHeaderById(billingHeaderId);
    if (!header) return null;

    const items = await this.repo.findItemsByHeaderId(billingHeaderId);
    if (items.length === 0) {
      throw new BadRequestError("請求に紐づく売上明細がありません");
    }

    const partner = await this.repo.findPartnerById(header.partnerId);

    // K-4-3: salesInvoiceIdが設定された行はsales_invoice_itemsへJOINして明細を取得し、
    // 未設定(完全手動入力)の行はbillingItems自身のitemName/quantity/unitPriceをそのまま使う
    const invoiceIds = items
      .map((i) => i.salesInvoiceId)
      .filter((id): id is string => !!id);
    const invoiceLineItems = await this.repo.findSalesInvoiceItemsByInvoiceIds(invoiceIds);
    const manualLineItems = items
      .filter((i) => !i.salesInvoiceId)
      .map((i) => ({
        itemName: i.itemName,
        quantity: i.quantity ?? 0,
        unitPrice: i.unitPrice ?? 0,
        amount: i.amount,
        taxCategoryCode: i.taxCategoryCode,
      }));
    const allLineItems = [...invoiceLineItems, ...manualLineItems];
    const taxCategoryRates = await this.repo.findTaxCategoryRates();
    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};

    // BUG-042: 税率別の内訳は、請求の合計(billing-crud.service.ts)と同じ明細・同じ計算で出す(返品・値引の売上はマイナス)
    const invoices = await this.repo.findSalesInvoicesByIds(invoiceIds);
    const { discountTotal, breakdown: taxBreakdown } = computeQuoteAmountBreakdown(
      buildBillingTaxLines(invoices, invoiceLineItems, manualLineItems),
      taxCategoryRates,
      toTaxRoundingMode(systemConfig.tax_rounding_mode),
    );

    const pdfData = {
      templateType: "INVOICE" as const,
      code: header.id,
      date: header.billingDate ? new Date(header.billingDate).toISOString().split("T")[0] : "",
      customerName: partner?.name || "ご担当者",
      totalAmount: header.totalAmount,
      taxAmount: header.taxAmount,
      memo: header.memo,
      quoteTitle: header.title || "ご請求の件",
      paymentTerms: DEFAULT_PAYMENT_TERMS,
      salesPersonName: "営業部 担当者",
      customCompanyName: systemConfig.company_name || "",
      customCompanyZip: systemConfig.company_zip || "",
      customCompanyAddress: systemConfig.company_address || "",
      customCompanyTel: systemConfig.company_tel || "",
      customCompanyFax: systemConfig.company_fax || "",
      companyInvoiceNo: systemConfig.company_invoice_registration_no
        ? String(systemConfig.company_invoice_registration_no)
        : "",
      items: allLineItems.map((i) => ({
        itemName: i.itemName || DEFAULT_ITEM_NAME,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      discountTotal,
      taxBreakdown,
    };

    const unitNames = await this.repo.findUnitNames();
    const customLayout = !withLayout
      ? null
      : await loadCustomLayoutSource(c.env, "billing_invoice", () =>
        resolveBillingPlaceholders({
          billingNo: header.id,
          billingDate: header.billingDate,
          periodStart: header.periodStart,
          periodEnd: header.periodEnd,
          partnerName: pdfData.customerName,
          title: header.title,
          memo: header.memo,
          paymentTerms: pdfData.paymentTerms,
          totalAmount: header.totalAmount,
          taxAmount: header.taxAmount,
          items: allLineItems,
          staffName: "",
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
        );

    const source: ReportPdfSource = {
      documentType: "billing_invoice",
      customLayout,
      fallback: { kind: "document", data: pdfData },
    };
    return { source, header };
  }

  // PERF-07 B-4: できた PDF を保存し、記録・監査ログを残す(generate-pdf と、ブラウザから受け取った PDF の両方)
  async storePdf(
    c: Context,
    billingHeaderId: string,
    pdfBinary: Uint8Array,
    built: Omit<NonNullable<Awaited<ReturnType<BillingPdfService["buildPdfSource"]>>>, "source">,
    uploadedBy?: { userId: string; size: number },
  ) {
    const { header } = built;
    const r2Path = generateAttachmentKey(`billing/${header.id}`, "generated_invoice.pdf");
    await c.env.BILLING_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const opId = await this.repo.getFallbackOperatorId(c);
    await this.repo.updateHeader(header.id, {
      status: "ISSUED",
      invoicePdfR2Path: r2Path,
      updatedBy: opId,
      updatedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "GENERATE_BILLING_PDF", RESOURCE_KEY, header.id, header, {
        mode: header.mode,
        r2Path,
        totalAmount: header.totalAmount,
        ...(uploadedBy ? { generatedIn: "browser", uploadedBy: uploadedBy.userId, pdfBytes: uploadedBy.size } : {}),
      }),
    );

    return {
      success: true,
      message: "請求書PDFを生成しました",
    };
  }
}
