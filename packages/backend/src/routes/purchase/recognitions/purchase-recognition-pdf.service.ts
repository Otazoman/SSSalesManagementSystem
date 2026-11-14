import { Context } from "hono";
import { PurchaseRecognitionRepository } from "./purchase-recognition.repository";
import { RESOURCE_KEY } from "./purchase-recognition-constants";
import { type ReportPdfSource } from "report-renderer";
import { DEFAULT_ITEM_NAME, DEFAULT_PAYMENT_TERMS } from "../../../platform/documents/document-defaults";
import { resolvePurchaseRecognitionPlaceholders } from "../../../platform/report-templates/resolve-document-placeholders";
import { loadCustomLayoutSource } from "../../../platform/report-templates/load-custom-layout";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { toTaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";

// Item10: sales-invoice-pdf.service.tsと同じ方針。仕入側には適格請求書要件(登録番号・税率別内訳)が
// 不要なため、標準では税率別内訳を持たないシンプルな固定レイアウト
// (reportLayouts.jsonの"PURCHASE_RECOGNITION"、仕入計上書)で生成する。
// 帳票テンプレート(mail-settingsのid"purchase_recognition"、Excel)が登録・コンパイル済みであれば
// そのテンプレートで描画する(税率別内訳・自社の登録番号も差し込める)。未登録・失敗時は標準レイアウトへ戻る
export class PurchaseRecognitionPdfService {
  private repo: PurchaseRecognitionRepository;

  constructor(repo: PurchaseRecognitionRepository) {
    this.repo = repo;
  }

  // PERF-07 B-3: PDF を作るためのデータ(GET /:id/pdf-source)。対象が無ければ null(発行できない状態ならエラー)。
  // withLayout が false の時(受け取った PDF の保存の時)は、Excel テンプレートのレイアウトを読まない
  async buildPdfSource(c: Context, id: string, withLayout = true) {
    const rows = await this.repo.findRecognitionWithPartner(id);
    if (rows.length === 0) return null;

    const hData = rows[0].purchaseRecognitions;
    const partnerMaster = rows[0].partners;
    const userMaster = rows[0].users;

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const resolvedPartnerName = partnerMaster?.name || "ご担当者";

    const items = await this.repo.findRecognitionItems(id);

    let staffName = "購買部 担当者";
    if (userMaster?.name) {
      staffName = userMaster.name;
    } else if (hData.purchasePersonEmployeeNumber) {
      const userRecord = await this.repo.findUserByEmployeeNumber(
        hData.purchasePersonEmployeeNumber,
      );
      if (userRecord?.name) staffName = userRecord.name;
    }

    const pdfData = {
      templateType: "PURCHASE_RECOGNITION" as const,
      code: hData.id,
      date: hData.recognitionDate
        ? new Date(hData.recognitionDate).toISOString().split("T")[0]
        : "",
      customerName: resolvedPartnerName,
      totalAmount: hData.totalAmount,
      taxAmount: hData.taxAmount,
      memo: hData.memo,
      quoteTitle: hData.title || "仕入計上の件",
      deliveryDate: hData.recognitionDate
        ? new Date(hData.recognitionDate).toISOString().split("T")[0]
        : "",
      purchaseOrderNumber: hData.orderId || "",
      paymentTerms: hData.paymentTerms || DEFAULT_PAYMENT_TERMS,
      salesPersonName: staffName,
      customCompanyName: hData.companyName || systemConfig.company_name || "",
      customCompanyZip: systemConfig.company_zip || "",
      customCompanyAddress: hData.companyAddress || systemConfig.company_address || "",
      customCompanyTel: hData.companyTel || systemConfig.company_tel || "",
      customCompanyFax: hData.companyFax || systemConfig.company_fax || "",
      items: items.map((i) => ({
        itemName: i.itemName || DEFAULT_ITEM_NAME,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    };

    const [taxCategoryRates, unitNames] = await Promise.all([
      this.repo.findTaxCategoryRates(),
      this.repo.findUnitNames(),
    ]);
    const customLayout = !withLayout
      ? null
      : await loadCustomLayoutSource(c.env, "purchase_recognition", () =>
        resolvePurchaseRecognitionPlaceholders({
          purchaseNo: hData.id,
          purchaseDate: hData.recognitionDate,
          purchaseOrderNo: hData.orderId,
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
            invoiceNo: systemConfig.company_invoice_registration_no
              ? String(systemConfig.company_invoice_registration_no)
              : "",
          },
          taxCategoryRates,
          taxRoundingMode: toTaxRoundingMode(systemConfig.tax_rounding_mode),
          unitNames,
        }),
        );

    const source: ReportPdfSource = {
      documentType: "purchase_recognition",
      customLayout,
      fallback: { kind: "document", data: pdfData },
    };
    return { source, hData, resolvedPartnerName };
  }

  // PERF-07 B-4: できた PDF を保存し、記録・監査ログを残す(generate-pdf と、ブラウザから受け取った PDF の両方)
  async storePdf(
    c: Context,
    id: string,
    pdfBinary: Uint8Array,
    built: Omit<NonNullable<Awaited<ReturnType<PurchaseRecognitionPdfService["buildPdfSource"]>>>, "source">,
    uploadedBy?: { userId: string; size: number },
  ) {
    const { hData, resolvedPartnerName } = built;
    const r2Path = generateAttachmentKey(`purchase-recognitions/${id}`, "generated_recognition.pdf");
    await c.env.PURCHASE_RECOGNITIONS_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const fallbackId = await this.repo.getFallbackOperatorId(c);
    const actualUserId = hData.updatedBy || fallbackId;
    const attachmentId = crypto.randomUUID();

    await this.repo.insertRecognitionAttachment({
      id: attachmentId,
      purchaseRecognitionId: id,
      fileName: await resolveDocumentFileName(c.env.DB, "purchase_recognition", id),
      storageType: "R2",
      attachmentR2Path: r2Path,
      externalUrl: null,
      fileType: "PDF",
      uploadedById: actualUserId,
      uploadedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "GENERATE_PURCHASE_RECOGNITION_PDF", RESOURCE_KEY, id, hData, {
        attachmentId,
        fileName: await resolveDocumentFileName(c.env.DB, "purchase_recognition", id),
        totalAmount: hData.totalAmount,
        customerName: resolvedPartnerName,
        ...(uploadedBy ? { generatedIn: "browser", uploadedBy: uploadedBy.userId, pdfBytes: uploadedBy.size } : {}),
      }),
    );

    return {
      success: true,
      message: "画面編集内容を反映した仕入計上書PDFを仕入履歴に生成しました",
    };
  }
}
