import { Context } from "hono";
import { PurchaseOrderRepository } from "./purchase-order.repository";
import { BulkSendEmailInput } from "./purchase-order.schema";
import { RESOURCE_KEY } from "./purchase-order-constants";
import { PurchaseOrderPdfService } from "./purchase-order-pdf.service";
import { writeMailDeliveryLog } from "../../../utils/mailLogger";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

// sales-order-mail.service.ts/quote-mail.service.tsと同じ方針。メール本文へOTPダウンロードリンクを
// 差し込む({download_link}があれば置換、無ければ末尾追記)
export function appendOrInjectDownloadLink(
  body: string,
  systemConfig: Record<string, unknown>,
  orderId: string,
  attachmentId: string,
): string {
  const siteUrl = String(systemConfig.site_url || "http://localhost:3000").replace(/\/$/, "");
  const downloadLink = `${siteUrl}/purchase-order-download?orderId=${encodeURIComponent(orderId)}&attachmentId=${encodeURIComponent(attachmentId)}`;

  if (body.includes("{download_link}")) {
    return body.replace(/{download_link}/g, downloadLink);
  }

  return [
    body,
    "",
    "--------------------------------------------------",
    "発注書のダウンロードはこちらのリンクからお願いいたします。",
    downloadLink,
    "(リンクを開いた後、ご登録のメールアドレス宛に送信される確認コードの入力が必要です)",
    "--------------------------------------------------",
  ].join("\n");
}

// sales-order-mail.service.tsと同じ方針(PDF未生成の発注に対してその場でPDF自動生成を試みる)
export class PurchaseOrderMailService {
  private repo: PurchaseOrderRepository;
  private pdfService: PurchaseOrderPdfService;

  constructor(repo: PurchaseOrderRepository, pdfService: PurchaseOrderPdfService) {
    this.repo = repo;
    this.pdfService = pdfService;
  }

  async bulkSendEmail(c: Context, payload: BulkSendEmailInput) {
    const { orderIds, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate("purchase_order");
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「発注書」のテンプレートが登録されていません");
    }

    const targetOrders = await this.repo.findApprovedOrdersByIds(orderIds);
    if (targetOrders.length === 0) {
      throw new NotFoundError("承認済みかつ有効な発注データが見つかりませんでした");
    }

    let successCount = 0;
    let failCount = 0;
    const executionResults = [];

    for (const order of targetOrders) {
      let pdfAttachment = await this.repo.findLatestPdfAttachment(order.id);

      if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
        try {
          await this.pdfService.generatePdf(c, order.id);
          pdfAttachment = await this.repo.findLatestPdfAttachment(order.id);
        } catch (genErr: any) {
          console.error(`[BULK SEND] PDF Auto-generation failed for order: ${order.id}`, genErr);
        }
      }

      if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
        failCount++;
        executionResults.push({
          id: order.id,
          status: "FAILED",
          error: "発注書PDFの自動生成に失敗しました",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "purchase_order",
          documentId: order.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(PDF自動生成失敗)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: null,
          status: "FAILED",
          errorMessage: "一括送信時の発注書PDF自動生成処理に失敗しました。フォントや設定等をご確認ください。",
          performedById: order.updatedBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      if (!order.partnerId) {
        failCount++;
        executionResults.push({
          id: order.id,
          status: "FAILED",
          error: "仕入先が設定されていません",
        });
        continue;
      }

      const activeContacts = await this.repo.findActiveContactsByPartnerId(order.partnerId);
      const validContacts = activeContacts.filter((c) => c.email && c.email.trim() !== "");

      if (validContacts.length === 0) {
        failCount++;
        executionResults.push({
          id: order.id,
          status: "FAILED",
          error: "取引先担当者マスタに、この帳票を送る設定でメールアドレスが登録された担当者が1人もいません",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "purchase_order",
          documentId: order.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(宛先マスタ空)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: pdfAttachment.attachmentR2Path,
          status: "FAILED",
          errorMessage: `取引先担当者マスタの中に、この取引先ID [${order.partnerId}] に対する「is_email_target = 1」のデータが登録されていません。`,
          performedById: order.updatedBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      const targetToEmails = validContacts.map((c) => c.email!.trim()).join(", ");
      const samplePartnerName =
        validContacts.length === 1
          ? `${order.companyName || ""} ${validContacts[0].name} 様`
          : `${order.companyName || ""} 御中 発注通知宛先担当者各位`;

      const replacedSubject = mailTemplate.subjectTemplate
        .replace(/{company_name}/g, order.companyName || "御中")
        .replace(/{doc_id}/g, order.id)
        .replace(/{total_amount}/g, `${order.totalAmount.toLocaleString()}円`);

      let replacedBody = mailTemplate.bodyTemplate
        .replace(/{company_name}/g, samplePartnerName)
        .replace(/{doc_id}/g, order.id)
        .replace(/{total_amount}/g, `${order.totalAmount.toLocaleString()}円`);
      replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, order.id, pdfAttachment.id);

      try {
        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          type: "email",
          category: "purchase_order",
          documentId: order.id,
          recipientTo: targetToEmails,
          recipientCc: mailTemplate.ccAddress,
          smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
          subject: replacedSubject,
          body: replacedBody,
          performedById: order.updatedBy || fallbackOperatorId || "UNKNOWN",
        });

        successCount++;
        executionResults.push({ id: order.id, status: "PENDING" });
      } catch (enqueueErr: any) {
        failCount++;
        executionResults.push({ id: order.id, status: "FAILED", error: enqueueErr.message });
      }
    }

    await logAuditEvent(c, "EXECUTE_BULK_SEND_PURCHASE_ORDERS_EMAIL", RESOURCE_KEY, "BULK", null, {
      requestedCount: orderIds.length,
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
    orderId: string,
    payload: { recipientEmail: string; fallbackOperatorId?: string },
  ) {
    const { recipientEmail, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate("purchase_order");
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「発注書」のテンプレートが登録されていません");
    }

    const targetOrders = await this.repo.findApprovedOrdersByIds([orderId]);
    if (targetOrders.length === 0) {
      throw new NotFoundError("承認済みかつ有効な発注データが見つかりませんでした");
    }
    const order = targetOrders[0];

    // BUG-029: 1件の送信でも、PDF が無ければその場で作ってから送る(一括送信と同じ)
    let pdfAttachment = await this.repo.findLatestPdfAttachment(order.id);
    if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
      try {
        await this.pdfService.generatePdf(c, order.id);
        pdfAttachment = await this.repo.findLatestPdfAttachment(order.id);
      } catch (genErr) {
        console.error(`[SINGLE SEND] PDF Auto-generation failed: ${order.id}`, genErr);
      }
    }
    if (!pdfAttachment || !pdfAttachment.attachmentR2Path) {
      throw new BadRequestError("発注書PDFの作成に失敗しました。帳票テンプレートの設定をご確認ください。");
    }

    const targetToEmails = recipientEmail.trim();
    const samplePartnerName = `${order.companyName || ""} 御中`;

    const replacedSubject = mailTemplate.subjectTemplate
      .replace(/{company_name}/g, order.companyName || "御中")
      .replace(/{doc_id}/g, order.id)
      .replace(/{total_amount}/g, `${order.totalAmount.toLocaleString()}円`);

    let replacedBody = mailTemplate.bodyTemplate
      .replace(/{company_name}/g, samplePartnerName)
      .replace(/{doc_id}/g, order.id)
      .replace(/{total_amount}/g, `${order.totalAmount.toLocaleString()}円`);
    replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, order.id, pdfAttachment.id);

    await enqueueNotification({
      dbLog: c.env.DB_LOG,
      type: "email",
      category: "purchase_order",
      documentId: order.id,
      recipientTo: targetToEmails,
      recipientCc: mailTemplate.ccAddress,
      smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
      subject: replacedSubject,
      body: replacedBody,
      performedById: order.updatedBy || fallbackOperatorId || "UNKNOWN",
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXECUTE_SINGLE_SEND_PURCHASE_ORDER_EMAIL", RESOURCE_KEY, "SINGLE", null, {
        orderId,
        recipientEmail,
      }),
    );

    return {
      success: true,
      message: `宛先「${targetToEmails}」へのメール送信を予約しました`,
    };
  }
}
