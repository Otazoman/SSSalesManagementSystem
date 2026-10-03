import { Context } from "hono";
import { QuoteRepository } from "./quote.repository";
import { BulkSendEmailInput } from "./quote.schema";
import { RESOURCE_KEY } from "./quote-constants";
import { QuotePdfService } from "./quote-pdf.service";
import { writeMailDeliveryLog } from "../../../utils/mailLogger";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

// Item4-c: 見積書メールの本文へOTPダウンロードリンクを差し込む。
// テンプレートに{download_link}が記載されていればそこへ置換し、無ければ本文末尾に追記する
// (既存テンプレートを編集しなくても必ずリンクが届くようにするためのフォールバック)。
export function appendOrInjectDownloadLink(
  body: string,
  systemConfig: Record<string, unknown>,
  quoteId: string,
  attachmentId: string,
): string {
  const siteUrl = String(systemConfig.site_url || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const downloadLink = `${siteUrl}/quote-download?quoteId=${encodeURIComponent(quoteId)}&attachmentId=${encodeURIComponent(attachmentId)}`;

  if (body.includes("{download_link}")) {
    return body.replace(/{download_link}/g, downloadLink);
  }

  return [
    body,
    "",
    "--------------------------------------------------",
    "見積書のダウンロードはこちらのリンクからお願いいたします。",
    downloadLink,
    "(リンクを開いた後、ご登録のメールアドレス宛に送信される確認コードの入力が必要です)",
    "--------------------------------------------------",
  ].join("\n");
}

// Item4-f: quote.service.tsから分割。見積書メールの一括送信・単独送信を担当。
// bulkSendEmailはPDF未生成の見積に対してその場でPDF自動生成を試みるため、QuotePdfServiceに依存する
export class QuoteMailService {
  private repo: QuoteRepository;
  private pdfService: QuotePdfService;

  constructor(repo: QuoteRepository, pdfService: QuotePdfService) {
    this.repo = repo;
    this.pdfService = pdfService;
  }

  // 10. メール一括送信
  async bulkSendEmail(c: Context, payload: BulkSendEmailInput) {
    const { quoteIds, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate("sales_quote");
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「見積書」のテンプレートが登録されていません");
    }

    const targetQuotes = await this.repo.findApprovedQuotesByIds(quoteIds);
    if (targetQuotes.length === 0) {
      throw new NotFoundError("承認済みかつ有効な見積データが見つかりませんでした");
    }

    let successCount = 0;
    let failCount = 0;
    const executionResults = [];

    for (const quote of targetQuotes) {
      let pdfAttachment = await this.repo.findLatestPdfAttachment(quote.id);

      // 💡 PDFが存在しない場合はその場で自動生成を行う
      if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
        try {
          await this.pdfService.generatePdf(c, quote.id);
          // 生成後に最新の添付ファイルレコードを再取得
          pdfAttachment = await this.repo.findLatestPdfAttachment(quote.id);
        } catch (genErr: any) {
          console.error(
            `[BULK SEND] PDF Auto-generation failed for quote: ${quote.id}`,
            genErr,
          );
        }
      }

      // 💡 自動生成を試みても取得できなかった場合のみエラーとする
      if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
        failCount++;
        executionResults.push({
          id: quote.id,
          status: "FAILED",
          error: "見積書PDFの自動生成に失敗しました",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "sales_quote",
          documentId: quote.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(PDF自動生成失敗)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: null,
          status: "FAILED",
          errorMessage:
            "一括送信時の見積書PDF自動生成処理に失敗しました。フォントや設定等をご確認ください。",
          performedById: quote.updatedBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      // findActiveContactsByCustomerId -> findActiveContactsByPartnerId
      // quote.customerId -> quote.partnerId
      const activeContacts = await this.repo.findActiveContactsByPartnerId(
        quote.partnerId,
      );
      const validContacts = activeContacts.filter(
        (c) => c.email && c.email.trim() !== "",
      );

      if (validContacts.length === 0) {
        failCount++;
        executionResults.push({
          id: quote.id,
          status: "FAILED",
          error:
            "取引先担当者マスタに、この帳票を送る設定でメールアドレスが登録された担当者が1人もいません",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "sales_quote",
          documentId: quote.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(宛先マスタ空)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: pdfAttachment.attachmentR2Path,
          status: "FAILED",
          errorMessage: `取引先担当者マスタの中に、この取引先ID [${quote.partnerId}] に対する「is_email_target = 1」のデータが登録されていません。`,
          performedById: quote.updatedBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      const targetToEmails = validContacts
        .map((c) => c.email!.trim())
        .join(", ");
      const samplePartnerName =
        validContacts.length === 1
          ? `${quote.companyName || ""} ${validContacts[0].name} 様`
          : `${quote.companyName || ""} 御中 見積通知宛先担当者各位`;

      const replacedSubject = mailTemplate.subjectTemplate
        .replace(/{company_name}/g, quote.companyName || "御中")
        .replace(/{doc_id}/g, quote.id)
        .replace(/{total_amount}/g, `${quote.totalAmount.toLocaleString()}円`);

      let replacedBody = mailTemplate.bodyTemplate
        .replace(/{company_name}/g, samplePartnerName)
        .replace(/{doc_id}/g, quote.id)
        .replace(/{total_amount}/g, `${quote.totalAmount.toLocaleString()}円`);
      replacedBody = appendOrInjectDownloadLink(
        replacedBody,
        systemConfig,
        quote.id,
        pdfAttachment.id,
      );

      // Item4-c: PDFをメール添付(base64)する方式から、OTP付きダウンロードリンクを本文に
      // 記載する方式へ変更(attachedR2Pathを渡さないため、Cron側での添付ファイル読み込みは発生しない)
      try {
        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          type: "email",
          category: "sales_quote",
          documentId: quote.id,
          recipientTo: targetToEmails,
          recipientCc: mailTemplate.ccAddress,
          smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
          subject: replacedSubject,
          body: replacedBody,
          performedById: quote.updatedBy || fallbackOperatorId || "UNKNOWN",
        });

        successCount++;
        executionResults.push({ id: quote.id, status: "PENDING" });
      } catch (enqueueErr: any) {
        failCount++;
        executionResults.push({
          id: quote.id,
          status: "FAILED",
          error: enqueueErr.message,
        });
      }
    }

    await logAuditEvent(c, "EXECUTE_BULK_SEND_QUOTES_EMAIL", RESOURCE_KEY, "BULK", null, {
      requestedCount: quoteIds.length,
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

  // 11. 単独メール送信
  async singleSendEmail(
    c: Context,
    quoteId: string,
    payload: { recipientEmail: string; fallbackOperatorId?: string },
  ) {
    const { recipientEmail, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate("sales_quote");
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「見積書」のテンプレートが登録されていません");
    }

    // 対象の見積データを取得
    const targetQuotes = await this.repo.findApprovedQuotesByIds([quoteId]);
    if (targetQuotes.length === 0) {
      throw new NotFoundError("承認済みかつ有効な見積データが見つかりませんでした");
    }
    const quote = targetQuotes[0];

    // BUG-029: 1件の送信でも、PDF が無ければその場で作ってから送る(一括送信と同じ)
    let pdfAttachment = await this.repo.findLatestPdfAttachment(quote.id);
    if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
      try {
        await this.pdfService.generatePdf(c, quote.id);
        pdfAttachment = await this.repo.findLatestPdfAttachment(quote.id);
      } catch (genErr) {
        console.error(`[SINGLE SEND] PDF Auto-generation failed: ${quote.id}`, genErr);
      }
    }
    if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
      throw new BadRequestError("見積書PDFの作成に失敗しました。帳票テンプレートの設定をご確認ください。");
    }

    // 💡 修正のコア：マスタから引くのではなく、フロントから渡されたアドレスをそのまま使う
    const targetToEmails = recipientEmail.trim();
    const samplePartnerName = `${quote.companyName || ""} 御中`;

    const replacedSubject = mailTemplate.subjectTemplate
      .replace(/{company_name}/g, quote.companyName || "御中")
      .replace(/{doc_id}/g, quote.id)
      .replace(/{total_amount}/g, `${quote.totalAmount.toLocaleString()}円`);

    let replacedBody = mailTemplate.bodyTemplate
      .replace(/{company_name}/g, samplePartnerName)
      .replace(/{doc_id}/g, quote.id)
      .replace(/{total_amount}/g, `${quote.totalAmount.toLocaleString()}円`);
    replacedBody = appendOrInjectDownloadLink(
      replacedBody,
      systemConfig,
      quote.id,
      pdfAttachment.id,
    );

    // Item4-c: PDFをメール添付(base64)する方式から、OTP付きダウンロードリンクを本文に
    // 記載する方式へ変更(attachedR2Pathを渡さないため、Cron側での添付ファイル読み込みは発生しない)
    await enqueueNotification({
      dbLog: c.env.DB_LOG,
      type: "email",
      category: "sales_quote",
      documentId: quote.id,
      recipientTo: targetToEmails, // 👈 自由入力したアドレスをセット
      recipientCc: mailTemplate.ccAddress,
      smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
      subject: replacedSubject,
      body: replacedBody,
      performedById: quote.updatedBy || fallbackOperatorId || "UNKNOWN",
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXECUTE_SINGLE_SEND_QUOTE_EMAIL", RESOURCE_KEY, "SINGLE", null, {
      quoteId,
      recipientEmail,
    }),
    );

    return {
      success: true,
      message: `宛先「${targetToEmails}」へのメール送信を予約しました`,
    };
  }
}
