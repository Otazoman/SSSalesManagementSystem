import { Context } from "hono";
import { ReceiptsRepository } from "./receipts.repository";
import { AcceptanceInspectionPdfService } from "./acceptance-inspection-pdf.service";
import { PartnerContactsRepository } from "../../master/partner-contacts/partner-contacts.repository";
import { writeMailDeliveryLog } from "../../../utils/mailLogger";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

const RESOURCE_KEY = "inventory_stock";

// purchase-order-mail.service.tsと同じ方針。メール本文へOTPダウンロードリンクを差し込む
// ({download_link}があれば置換、無ければ末尾追記)
export function appendOrInjectDownloadLink(
  body: string,
  systemConfig: Record<string, unknown>,
  receiptId: string,
  attachmentId: string,
): string {
  const siteUrl = String(systemConfig.site_url || "http://localhost:3000").replace(/\/$/, "");
  const downloadLink = `${siteUrl}/acceptance-inspection-download?receiptId=${encodeURIComponent(receiptId)}&attachmentId=${encodeURIComponent(attachmentId)}`;

  if (body.includes("{download_link}")) {
    return body.replace(/{download_link}/g, downloadLink);
  }

  return [
    body,
    "",
    "--------------------------------------------------",
    "検収書のダウンロードはこちらのリンクからお願いいたします。",
    downloadLink,
    "(リンクを開いた後、ご登録のメールアドレス宛に送信される確認コードの入力が必要です)",
    "--------------------------------------------------",
  ].join("\n");
}

// purchase-order-mail.service.tsと同じ方針(PDF未生成の入庫に対してその場でPDF自動生成を試みる)
export class AcceptanceInspectionMailService {
  constructor(
    private repo: ReceiptsRepository,
    private pdfService: AcceptanceInspectionPdfService,
  ) {}

  async bulkSendEmail(c: Context, payload: { receiptIds: string[]; fallbackOperatorId?: string }) {
    const { receiptIds, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate("acceptance_inspection");
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「検収書」のテンプレートが登録されていません");
    }

    const targetReceipts = await this.repo.findApprovedReceiptsByIds(receiptIds);
    if (targetReceipts.length === 0) {
      throw new NotFoundError("承認済みかつ有効な入庫データが見つかりませんでした");
    }

    const contactsRepo = new PartnerContactsRepository(c.env.DB);
    let successCount = 0;
    let failCount = 0;
    const executionResults = [];

    for (const receipt of targetReceipts) {
      let pdfAttachment = await this.repo.findLatestPdfAttachment(receipt.id);

      if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
        try {
          await this.pdfService.generatePdf(c, receipt.id);
          pdfAttachment = await this.repo.findLatestPdfAttachment(receipt.id);
        } catch (genErr: any) {
          console.error(`[BULK SEND] PDF Auto-generation failed for receipt: ${receipt.id}`, genErr);
        }
      }

      if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
        failCount++;
        executionResults.push({
          id: receipt.id,
          status: "FAILED",
          error: "検収書PDFの自動生成に失敗しました",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "acceptance_inspection",
          documentId: receipt.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(PDF自動生成失敗)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: null,
          status: "FAILED",
          errorMessage: "一括送信時の検収書PDF自動生成処理に失敗しました。フォントや設定等をご確認ください。",
          performedById: receipt.createdBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      if (!receipt.partnerId) {
        failCount++;
        executionResults.push({ id: receipt.id, status: "FAILED", error: "仕入先が設定されていません" });
        continue;
      }

      const activeContacts = await contactsRepo.findActiveContactsForDocument(receipt.partnerId, "acceptance_inspection");
      const validContacts = activeContacts.filter((ct) => ct.email && ct.email.trim() !== "");

      if (validContacts.length === 0) {
        failCount++;
        executionResults.push({
          id: receipt.id,
          status: "FAILED",
          error: "取引先担当者マスタに、この帳票を送る設定でメールアドレスが登録された担当者が1人もいません",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "acceptance_inspection",
          documentId: receipt.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(宛先マスタ空)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: pdfAttachment.attachmentR2Path,
          status: "FAILED",
          errorMessage: `取引先担当者マスタの中に、この取引先ID [${receipt.partnerId}] に対する「is_email_target = 1」のデータが登録されていません。`,
          performedById: receipt.createdBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      const targetToEmails = validContacts.map((ct) => ct.email!.trim()).join(", ");
      const samplePartnerName =
        validContacts.length === 1
          ? `${validContacts[0].name} 様`
          : "検収書送付先担当者各位";

      const replacedSubject = mailTemplate.subjectTemplate
        .replace(/{company_name}/g, samplePartnerName)
        .replace(/{doc_id}/g, receipt.id);

      let replacedBody = mailTemplate.bodyTemplate
        .replace(/{company_name}/g, samplePartnerName)
        .replace(/{doc_id}/g, receipt.id);
      replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, receipt.id, pdfAttachment.id);

      try {
        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          type: "email",
          category: "acceptance_inspection",
          documentId: receipt.id,
          recipientTo: targetToEmails,
          recipientCc: mailTemplate.ccAddress,
          smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
          subject: replacedSubject,
          body: replacedBody,
          performedById: receipt.createdBy || fallbackOperatorId || "UNKNOWN",
        });

        successCount++;
        executionResults.push({ id: receipt.id, status: "PENDING" });
      } catch (enqueueErr: any) {
        failCount++;
        executionResults.push({ id: receipt.id, status: "FAILED", error: enqueueErr.message });
      }
    }

    await logAuditEvent(c, "EXECUTE_BULK_SEND_ACCEPTANCE_INSPECTIONS_EMAIL", RESOURCE_KEY, "BULK", null, {
      requestedCount: receiptIds.length,
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
    receiptId: string,
    payload: { recipientEmail: string; fallbackOperatorId?: string },
  ) {
    const { recipientEmail, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate("acceptance_inspection");
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「検収書」のテンプレートが登録されていません");
    }

    const targetReceipts = await this.repo.findApprovedReceiptsByIds([receiptId]);
    if (targetReceipts.length === 0) {
      throw new NotFoundError("承認済みかつ有効な入庫データが見つかりませんでした");
    }
    const receipt = targetReceipts[0];

    let pdfAttachment = await this.repo.findLatestPdfAttachment(receipt.id);
    if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
      try {
        await this.pdfService.generatePdf(c, receipt.id);
        pdfAttachment = await this.repo.findLatestPdfAttachment(receipt.id);
      } catch (genErr: any) {
        console.error(`[SINGLE SEND] PDF Auto-generation failed for receipt: ${receipt.id}`, genErr);
      }
    }
    if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
      throw new BadRequestError("検収書PDFの作成に失敗しました。帳票テンプレートの設定をご確認ください。");
    }

    const targetToEmails = recipientEmail.trim();

    const replacedSubject = mailTemplate.subjectTemplate
      .replace(/{company_name}/g, "御中")
      .replace(/{doc_id}/g, receipt.id);

    let replacedBody = mailTemplate.bodyTemplate
      .replace(/{company_name}/g, "御中")
      .replace(/{doc_id}/g, receipt.id);
    replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, receipt.id, pdfAttachment.id);

    await enqueueNotification({
      dbLog: c.env.DB_LOG,
      type: "email",
      category: "acceptance_inspection",
      documentId: receipt.id,
      recipientTo: targetToEmails,
      recipientCc: mailTemplate.ccAddress,
      smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
      subject: replacedSubject,
      body: replacedBody,
      performedById: receipt.createdBy || fallbackOperatorId || "UNKNOWN",
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXECUTE_SINGLE_SEND_ACCEPTANCE_INSPECTION_EMAIL", RESOURCE_KEY, "SINGLE", null, {
        receiptId,
        recipientEmail,
      }),
    );

    return {
      success: true,
      message: `宛先「${targetToEmails}」へのメール送信を予約しました`,
    };
  }
}
