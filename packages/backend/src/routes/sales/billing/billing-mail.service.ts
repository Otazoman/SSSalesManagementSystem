import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import { BillingPdfService } from "./billing-pdf.service";
import { BulkSendEmailInput } from "./billing.schema";
import { RESOURCE_KEY } from "./billing-constants";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { writeMailDeliveryLog } from "../../../utils/mailLogger";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

// K-4-4: 請求書の送信・再送付。sales-invoice-mail.service.tsと同じ方針。
// mail_template_settingsのid"billing_invoice"は事前に用意済みだったが、これまでどこからも
// 参照されていなかった(K-4-4で初めて配線)
// 追加要望(2026-09-16ユーザー確認済み): 請求管理を正式な請求書発行の一本化窓口とするため、
// PDFを直接添付する方式からsales-invoice-mail.service.tsと同じOTPセルフダウンロードリンク
// 方式へ変更した(メール本文へのPDF直接添付は行わない)
// 追加要望: 「PDFを発行してから送信する」という2手順がわかりにくいとの指摘を受け、
// sales-invoice-mail.service.tsのbulkSendEmailと同じく、PDF未発行の場合は送信時に自動生成する
// ように変更(個別送信・一括送信とも)。あわせて一覧からの一括送信にも対応した
const MAIL_TEMPLATE_ID = "billing_invoice";

// sales-invoice-mail.service.tsのappendOrInjectDownloadLinkと同じ方針
export function appendOrInjectDownloadLink(
  body: string,
  systemConfig: Record<string, unknown>,
  billingHeaderId: string,
): string {
  const siteUrl = String(systemConfig.site_url || "http://localhost:3000").replace(/\/$/, "");
  const downloadLink = `${siteUrl}/billing-download?billingId=${encodeURIComponent(billingHeaderId)}`;

  if (body.includes("{download_link}")) {
    return body.replace(/{download_link}/g, downloadLink);
  }

  return [
    body,
    "",
    "--------------------------------------------------",
    "請求書のダウンロードはこちらのリンクからお願いいたします。",
    downloadLink,
    "(リンクを開いた後、ご登録のメールアドレス宛に送信される確認コードの入力が必要です)",
    "--------------------------------------------------",
  ].join("\n");
}

export class BillingMailService {
  private repo: BillingRepository;
  private pdfService: BillingPdfService;

  constructor(repo: BillingRepository, pdfService: BillingPdfService) {
    this.repo = repo;
    this.pdfService = pdfService;
  }

  async singleSendEmail(
    c: Context,
    billingHeaderId: string,
    payload: { recipientEmail: string; fallbackOperatorId?: string },
  ) {
    const { recipientEmail, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate(MAIL_TEMPLATE_ID);
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「請求書」のテンプレートが登録されていません");
    }

    let header = await this.repo.findHeaderById(billingHeaderId);
    if (!header) {
      throw new NotFoundError("対象の請求データが見つかりません");
    }

    if (!header.invoicePdfR2Path) {
      await this.pdfService.generatePdf(c, billingHeaderId);
      header = await this.repo.findHeaderById(billingHeaderId);
      if (!header || !header.invoicePdfR2Path) {
        throw new BadRequestError("請求書PDFの作成に失敗しました。帳票テンプレートの設定をご確認ください。");
      }
    }

    const partner = await this.repo.findPartnerById(header.partnerId);
    const companyName = partner?.name || "";

    const targetToEmails = recipientEmail.trim();
    const samplePartnerName = `${companyName} 御中`;

    const replacedSubject = mailTemplate.subjectTemplate
      .replace(/{company_name}/g, companyName || "御中")
      .replace(/{doc_id}/g, header.id)
      .replace(/{total_amount}/g, `${header.totalAmount.toLocaleString()}円`);

    let replacedBody = mailTemplate.bodyTemplate
      .replace(/{company_name}/g, samplePartnerName)
      .replace(/{doc_id}/g, header.id)
      .replace(/{total_amount}/g, `${header.totalAmount.toLocaleString()}円`);
    replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, header.id);

    await enqueueNotification({
      dbLog: c.env.DB_LOG,
      type: "email",
      category: "sales_billing",
      documentId: header.id,
      recipientTo: targetToEmails,
      recipientCc: mailTemplate.ccAddress,
      smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
      subject: replacedSubject,
      body: replacedBody,
      performedById: header.updatedBy || fallbackOperatorId || "UNKNOWN",
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXECUTE_SINGLE_SEND_BILLING_EMAIL", RESOURCE_KEY, "SINGLE", null, {
        billingHeaderId,
        recipientEmail,
      }),
    );

    return {
      success: true,
      message: `宛先「${targetToEmails}」へのメール送信を予約しました`,
    };
  }

  // 追加要望: 一覧からの複数請求まとめてのメール送信(sales-invoice-mail.service.tsのbulkSendEmailと同型)
  async bulkSendEmail(c: Context, payload: BulkSendEmailInput) {
    const { billingHeaderIds, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate(MAIL_TEMPLATE_ID);
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「請求書」のテンプレートが登録されていません");
    }

    const targetHeaders = await this.repo.findHeadersByIds(billingHeaderIds);
    if (targetHeaders.length === 0) {
      throw new NotFoundError("対象の請求データが見つかりませんでした");
    }

    let successCount = 0;
    let failCount = 0;
    const executionResults: Array<{ id: string; status: string; error?: string }> = [];

    for (const header of targetHeaders) {
      let target = header;
      if (!target.invoicePdfR2Path) {
        try {
          await this.pdfService.generatePdf(c, target.id);
          const refreshed = await this.repo.findHeaderById(target.id);
          if (refreshed) target = refreshed;
        } catch (genErr: any) {
          console.error(`[BULK SEND] PDF Auto-generation failed for billing: ${target.id}`, genErr);
        }
      }

      if (!target.invoicePdfR2Path) {
        failCount++;
        executionResults.push({
          id: target.id,
          status: "FAILED",
          error: "請求書PDFの自動生成に失敗しました",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "sales_billing",
          documentId: target.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(PDF自動生成失敗)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: null,
          status: "FAILED",
          errorMessage:
            "一括送信時の請求書PDF自動生成処理に失敗しました。フォントや設定等をご確認ください。",
          performedById: target.updatedBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      const activeContacts = await this.repo.findActiveContactsByPartnerId(target.partnerId);
      const validContacts = activeContacts.filter((c) => c.email && c.email.trim() !== "");

      if (validContacts.length === 0) {
        failCount++;
        executionResults.push({
          id: target.id,
          status: "FAILED",
          error: "取引先担当者マスタに、この帳票を送る設定でメールアドレスが登録された担当者が1人もいません",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "sales_billing",
          documentId: target.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(宛先マスタ空)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: target.invoicePdfR2Path,
          status: "FAILED",
          errorMessage: `取引先担当者マスタの中に、この取引先ID [${target.partnerId}] に対する「is_email_target = 1」のデータが登録されていません。`,
          performedById: target.updatedBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      const partner = await this.repo.findPartnerById(target.partnerId);
      const companyName = partner?.name || "";
      const targetToEmails = validContacts.map((c) => c.email!.trim()).join(", ");
      const samplePartnerName =
        validContacts.length === 1
          ? `${companyName} ${validContacts[0].name} 様`
          : `${companyName} 御中 通知宛先担当者各位`;

      const replacedSubject = mailTemplate.subjectTemplate
        .replace(/{company_name}/g, companyName || "御中")
        .replace(/{doc_id}/g, target.id)
        .replace(/{total_amount}/g, `${target.totalAmount.toLocaleString()}円`);

      let replacedBody = mailTemplate.bodyTemplate
        .replace(/{company_name}/g, samplePartnerName)
        .replace(/{doc_id}/g, target.id)
        .replace(/{total_amount}/g, `${target.totalAmount.toLocaleString()}円`);
      replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, target.id);

      try {
        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          type: "email",
          category: "sales_billing",
          documentId: target.id,
          recipientTo: targetToEmails,
          recipientCc: mailTemplate.ccAddress,
          smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
          subject: replacedSubject,
          body: replacedBody,
          performedById: target.updatedBy || fallbackOperatorId || "UNKNOWN",
        });

        successCount++;
        executionResults.push({ id: target.id, status: "PENDING" });
      } catch (enqueueErr: any) {
        failCount++;
        executionResults.push({ id: target.id, status: "FAILED", error: enqueueErr.message });
      }
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXECUTE_BULK_SEND_BILLING_EMAIL", RESOURCE_KEY, "BULK", null, {
        requestedCount: billingHeaderIds.length,
        successCount,
        failCount,
        details: executionResults,
      }),
    );

    return {
      success: true,
      message: `メールの一括送信を予約しました。(予約: ${successCount}件 / 失敗: ${failCount}件)`,
      results: executionResults,
    };
  }
}
