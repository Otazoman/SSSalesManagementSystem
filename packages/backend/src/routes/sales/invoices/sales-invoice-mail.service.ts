import { Context } from "hono";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { BulkSendEmailInput } from "./sales-invoice.schema";
import { RESOURCE_KEY } from "./sales-invoice-constants";
import { SalesInvoicePdfService } from "./sales-invoice-pdf.service";
import { writeMailDeliveryLog } from "../../../utils/mailLogger";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

// K-4-1: mail_template_settingsのid"sales_invoice"は既に納品書(delivery-note-mail.service.ts)が
// 使用済みのため、本機能(売上計上の個別/一括メール送信)は新規id"sales_recognition"を使う
const MAIL_TEMPLATE_ID = "sales_recognition";

// K-4-1: quote-mail.service.tsと同じ方針(DL本文へのOTPダウンロードリンク差し込み)
export function appendOrInjectDownloadLink(
  body: string,
  systemConfig: Record<string, unknown>,
  invoiceId: string,
  attachmentId: string,
): string {
  const siteUrl = String(systemConfig.site_url || "http://localhost:3000").replace(/\/$/, "");
  const downloadLink = `${siteUrl}/sales-invoice-download?invoiceId=${encodeURIComponent(invoiceId)}&attachmentId=${encodeURIComponent(attachmentId)}`;

  if (body.includes("{download_link}")) {
    return body.replace(/{download_link}/g, downloadLink);
  }

  return [
    body,
    "",
    "--------------------------------------------------",
    "書類のダウンロードはこちらのリンクからお願いいたします。",
    downloadLink,
    "(リンクを開いた後、ご登録のメールアドレス宛に送信される確認コードの入力が必要です)",
    "--------------------------------------------------",
  ].join("\n");
}

// K-4-1: quote-mail.service.tsと同じ方針。売上計上メールの一括送信・単独送信を担当。
export class SalesInvoiceMailService {
  private repo: SalesInvoiceRepository;
  private pdfService: SalesInvoicePdfService;

  constructor(repo: SalesInvoiceRepository, pdfService: SalesInvoicePdfService) {
    this.repo = repo;
    this.pdfService = pdfService;
  }

  async bulkSendEmail(c: Context, payload: BulkSendEmailInput) {
    const { invoiceIds, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate(MAIL_TEMPLATE_ID);
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「売上計上」のテンプレートが登録されていません");
    }

    const targetInvoices = await this.repo.findApprovedInvoicesByIds(invoiceIds);
    if (targetInvoices.length === 0) {
      throw new NotFoundError("承認済みかつ有効な売上データが見つかりませんでした");
    }

    let successCount = 0;
    let failCount = 0;
    const executionResults = [];

    for (const invoice of targetInvoices) {
      let pdfAttachment = await this.repo.findLatestPdfAttachment(invoice.id);

      if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
        try {
          await this.pdfService.generatePdf(c, invoice.id);
          pdfAttachment = await this.repo.findLatestPdfAttachment(invoice.id);
        } catch (genErr: any) {
          console.error(
            `[BULK SEND] PDF Auto-generation failed for sales_invoice: ${invoice.id}`,
            genErr,
          );
        }
      }

      if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
        failCount++;
        executionResults.push({
          id: invoice.id,
          status: "FAILED",
          error: "売上関連書類PDFの自動生成に失敗しました",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "sales_invoice",
          documentId: invoice.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(PDF自動生成失敗)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: null,
          status: "FAILED",
          errorMessage:
            "一括送信時の売上関連書類PDF自動生成処理に失敗しました。フォントや設定等をご確認ください。",
          performedById: invoice.updatedBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      const activeContacts = await this.repo.findActiveContactsByPartnerId(invoice.partnerId, invoice.documentType);
      const validContacts = activeContacts.filter((c) => c.email && c.email.trim() !== "");

      if (validContacts.length === 0) {
        failCount++;
        executionResults.push({
          id: invoice.id,
          status: "FAILED",
          error: "取引先担当者マスタに、この帳票を送る設定でメールアドレスが登録された担当者が1人もいません",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "sales_invoice",
          documentId: invoice.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(宛先マスタ空)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: pdfAttachment.attachmentR2Path,
          status: "FAILED",
          errorMessage: `取引先担当者マスタの中に、この取引先ID [${invoice.partnerId}] に対する「is_email_target = 1」のデータが登録されていません。`,
          performedById: invoice.updatedBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      const targetToEmails = validContacts.map((c) => c.email!.trim()).join(", ");
      const samplePartnerName =
        validContacts.length === 1
          ? `${invoice.companyName || ""} ${validContacts[0].name} 様`
          : `${invoice.companyName || ""} 御中 通知宛先担当者各位`;

      const replacedSubject = mailTemplate.subjectTemplate
        .replace(/{company_name}/g, invoice.companyName || "御中")
        .replace(/{doc_id}/g, invoice.id)
        .replace(/{total_amount}/g, `${invoice.totalAmount.toLocaleString()}円`);

      let replacedBody = mailTemplate.bodyTemplate
        .replace(/{company_name}/g, samplePartnerName)
        .replace(/{doc_id}/g, invoice.id)
        .replace(/{total_amount}/g, `${invoice.totalAmount.toLocaleString()}円`);
      replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, invoice.id, pdfAttachment.id);

      try {
        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          type: "email",
          category: "sales_invoice",
          documentId: invoice.id,
          recipientTo: targetToEmails,
          recipientCc: mailTemplate.ccAddress,
          smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
          subject: replacedSubject,
          body: replacedBody,
          performedById: invoice.updatedBy || fallbackOperatorId || "UNKNOWN",
        });

        successCount++;
        executionResults.push({ id: invoice.id, status: "PENDING" });
      } catch (enqueueErr: any) {
        failCount++;
        executionResults.push({ id: invoice.id, status: "FAILED", error: enqueueErr.message });
      }
    }

    await logAuditEvent(c, "EXECUTE_BULK_SEND_SALES_INVOICES_EMAIL", RESOURCE_KEY, "BULK", null, {
      requestedCount: invoiceIds.length,
      successCount,
      failCount,
      details: executionResults,
    });

    return {
      success: true,
      message: `メールの一括送信を予約しました。(予約: ${successCount}件 / 失敗: ${failCount}件)`,
      results: executionResults,
    };
  }

  async singleSendEmail(
    c: Context,
    invoiceId: string,
    payload: { recipientEmail: string; fallbackOperatorId?: string },
  ) {
    const { recipientEmail, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate(MAIL_TEMPLATE_ID);
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「売上計上」のテンプレートが登録されていません");
    }

    const targetInvoices = await this.repo.findApprovedInvoicesByIds([invoiceId]);
    if (targetInvoices.length === 0) {
      throw new NotFoundError("承認済みかつ有効な売上データが見つかりませんでした");
    }
    const invoice = targetInvoices[0];

    // BUG-029: 1件の送信でも、PDF が無ければその場で作ってから送る(一括送信と同じ)
    let pdfAttachment = await this.repo.findLatestPdfAttachment(invoice.id);
    if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
      try {
        await this.pdfService.generatePdf(c, invoice.id);
        pdfAttachment = await this.repo.findLatestPdfAttachment(invoice.id);
      } catch (genErr) {
        console.error(`[SINGLE SEND] PDF Auto-generation failed: ${invoice.id}`, genErr);
      }
    }
    if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
      throw new BadRequestError("売上関連書類PDFの作成に失敗しました。帳票テンプレートの設定をご確認ください。");
    }

    const targetToEmails = recipientEmail.trim();
    const samplePartnerName = `${invoice.companyName || ""} 御中`;

    const replacedSubject = mailTemplate.subjectTemplate
      .replace(/{company_name}/g, invoice.companyName || "御中")
      .replace(/{doc_id}/g, invoice.id)
      .replace(/{total_amount}/g, `${invoice.totalAmount.toLocaleString()}円`);

    let replacedBody = mailTemplate.bodyTemplate
      .replace(/{company_name}/g, samplePartnerName)
      .replace(/{doc_id}/g, invoice.id)
      .replace(/{total_amount}/g, `${invoice.totalAmount.toLocaleString()}円`);
    replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, invoice.id, pdfAttachment.id);

    await enqueueNotification({
      dbLog: c.env.DB_LOG,
      type: "email",
      category: "sales_invoice",
      documentId: invoice.id,
      recipientTo: targetToEmails,
      recipientCc: mailTemplate.ccAddress,
      smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
      subject: replacedSubject,
      body: replacedBody,
      performedById: invoice.updatedBy || fallbackOperatorId || "UNKNOWN",
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXECUTE_SINGLE_SEND_SALES_INVOICE_EMAIL", RESOURCE_KEY, "SINGLE", null, {
        invoiceId,
        recipientEmail,
      }),
    );

    return {
      success: true,
      message: `宛先「${targetToEmails}」へのメール送信を予約しました`,
    };
  }
}
