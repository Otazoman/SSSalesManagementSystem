import { Context } from "hono";
import { ShipmentsRepository } from "./shipments.repository";
import { DeliveryNotePdfService } from "./delivery-note-pdf.service";
import { BulkSendDeliveryNoteEmailInput } from "./shipments.schema";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { PartnerContactsRepository } from "../../master/partner-contacts/partner-contacts.repository";
import { writeMailDeliveryLog } from "../../../utils/mailLogger";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

const RESOURCE_KEY = "inventory_stock";

// 納品書メール送信(方式A): sales-order-mail.service.tsのappendOrInjectDownloadLinkと同じ方針。
// メール本文へOTPダウンロードリンクを差し込む({download_link}があれば置換、無ければ末尾追記)。
// リンク自体はdelivery-note-pdf.service.tsが元々自動送信時に使っていたものと同じ形式
// (shipmentHeaderIdをinstructionId/attachmentIdの両方に使い回す)を踏襲する。
export function appendOrInjectDownloadLink(
  body: string,
  systemConfig: Record<string, unknown>,
  shipmentHeaderId: string,
): string {
  const siteUrl = String(systemConfig.site_url || "http://localhost:3000").replace(/\/$/, "");
  const downloadLink = `${siteUrl}/delivery-note-download?instructionId=${encodeURIComponent(shipmentHeaderId)}&attachmentId=${encodeURIComponent(shipmentHeaderId)}`;

  if (body.includes("{download_link}")) {
    return body.replace(/{download_link}/g, downloadLink);
  }

  return [
    body,
    "",
    "--------------------------------------------------",
    "納品書のダウンロードはこちらのリンクからお願いいたします。",
    downloadLink,
    "(リンクを開いた後、ご登録のメールアドレス宛に送信される確認コードの入力が必要です)",
    "--------------------------------------------------",
  ].join("\n");
}

// Item7残課題7フォローアップ: 見積・受注・発注と同じ「選択して送信(方式A)」を納品書にも導入。
// 従来はdelivery-note-pdf.service.ts側で出庫確定時に登録済み連絡先全員へ自動一斉送信していたが、
// ユーザー判断により自動送信は廃止し、本サービス経由の手動送信(個別/一括)に一本化した。
export class DeliveryNoteMailService {
  constructor(private repo: ShipmentsRepository) {}

  // BUG-030: 納品書の PDF が無ければ、その場で作る(承認時の自動作成に失敗した場合など)。
  // 作れた場合は header の R2 パスを更新する。得意先が無い・作成に失敗した場合は何もしない(呼び出し側で送信エラーにする)
  private async ensureDeliveryNote(
    c: Context,
    header: { id: string; partnerId: string | null; deliveryNoteR2Path: string | null },
  ) {
    if (header.deliveryNoteR2Path || !header.partnerId) return;
    try {
      await new DeliveryNotePdfService(this.repo).generatePdf(c as any, header.id);
      header.deliveryNoteR2Path = (await this.repo.findHeaderById(header.id))?.deliveryNoteR2Path ?? null;
    } catch (err) {
      console.error(`[SEND] Delivery note auto-generation failed: ${header.id}`, err);
    }
  }

  async bulkSendEmail(c: Context, payload: BulkSendDeliveryNoteEmailInput) {
    const { shipmentHeaderIds, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate("sales_invoice");
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「納品書」のテンプレートが登録されていません");
    }

    const targetShipments = await this.repo.findApprovedShipmentsByIds(shipmentHeaderIds);
    if (targetShipments.length === 0) {
      throw new NotFoundError("承認済みかつ有効な出庫データが見つかりませんでした");
    }

    const partnersRepo = new PartnersRepository(c.env.DB);
    const contactsRepo = new PartnerContactsRepository(c.env.DB);

    let successCount = 0;
    let failCount = 0;
    const executionResults = [];

    for (const header of targetShipments) {
      await this.ensureDeliveryNote(c, header);
      if (!header.partnerId || !header.deliveryNoteR2Path) {
        failCount++;
        executionResults.push({
          id: header.id,
          status: "FAILED",
          error: "納品書PDFがまだ生成されていません(得意先未設定、または生成に失敗した可能性があります)",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "delivery_note",
          documentId: header.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(納品書PDF未生成)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: null,
          status: "FAILED",
          errorMessage: "得意先未設定、または納品書PDFの自動生成に失敗した出庫のため送信できません。",
          performedById: header.createdBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      const partner = await partnersRepo.findById(header.partnerId);
      const activeContacts = await contactsRepo.findActiveContactsForDocument(header.partnerId, "delivery_note");
      const validContacts = activeContacts.filter((ct) => ct.email && ct.email.trim() !== "");

      if (validContacts.length === 0) {
        failCount++;
        executionResults.push({
          id: header.id,
          status: "FAILED",
          error: "取引先担当者マスタに、この帳票を送る設定でメールアドレスが登録された担当者が1人もいません",
        });
        await writeMailDeliveryLog({
          dbLogBinding: c.env.DB_LOG,
          category: "delivery_note",
          documentId: header.id,
          smtpFrom: "",
          recipientTo: "⚠️ 送信前エラー(宛先マスタ空)",
          recipientCc: mailTemplate.ccAddress,
          subject: `【配信拒否】${mailTemplate.subjectTemplate}`,
          attachedR2Path: header.deliveryNoteR2Path,
          status: "FAILED",
          errorMessage: `取引先担当者マスタの中に、この取引先ID [${header.partnerId}] に対する「is_email_target = 1」のデータが登録されていません。`,
          performedById: header.createdBy || fallbackOperatorId || "UNKNOWN",
        });
        continue;
      }

      const targetToEmails = validContacts.map((ct) => ct.email!.trim()).join(", ");
      const samplePartnerName =
        validContacts.length === 1
          ? `${partner?.name || ""} ${validContacts[0].name} 様`
          : `${partner?.name || ""} 御中 納品書送付先担当者各位`;

      const replacedSubject = mailTemplate.subjectTemplate
        .replace(/{company_name}/g, partner?.name || "御中")
        .replace(/{doc_id}/g, header.id);

      let replacedBody = mailTemplate.bodyTemplate
        .replace(/{company_name}/g, samplePartnerName)
        .replace(/{doc_id}/g, header.id);
      replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, header.id);

      try {
        await enqueueNotification({
          dbLog: c.env.DB_LOG,
          type: "email",
          category: "delivery_note",
          documentId: header.id,
          recipientTo: targetToEmails,
          recipientCc: mailTemplate.ccAddress,
          smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
          subject: replacedSubject,
          body: replacedBody,
          performedById: header.createdBy || fallbackOperatorId || "UNKNOWN",
        });

        successCount++;
        executionResults.push({ id: header.id, status: "PENDING" });
      } catch (enqueueErr: any) {
        failCount++;
        executionResults.push({ id: header.id, status: "FAILED", error: enqueueErr.message });
      }
    }

    await logAuditEvent(c, "EXECUTE_BULK_SEND_DELIVERY_NOTES_EMAIL", RESOURCE_KEY, "BULK", null, {
      requestedCount: shipmentHeaderIds.length,
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
    shipmentHeaderId: string,
    payload: { recipientEmail: string; fallbackOperatorId?: string },
  ) {
    const { recipientEmail, fallbackOperatorId } = payload;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");

    const mailTemplate = await this.repo.findMailTemplate("sales_invoice");
    if (!mailTemplate) {
      throw new BadRequestError("メール送信設定に「納品書」のテンプレートが登録されていません");
    }

    const targetShipments = await this.repo.findApprovedShipmentsByIds([shipmentHeaderId]);
    if (targetShipments.length === 0) {
      throw new NotFoundError("承認済みかつ有効な出庫データが見つかりませんでした");
    }
    const header = targetShipments[0];

    await this.ensureDeliveryNote(c, header);
    if (!header.deliveryNoteR2Path) {
      throw new BadRequestError(
        header.partnerId
          ? "納品書PDFの作成に失敗しました。帳票テンプレート・フォントの設定をご確認ください。"
          : "得意先が設定されていない出庫には、納品書を作成できません。",
      );
    }

    const partnersRepo = new PartnersRepository(c.env.DB);
    const partner = header.partnerId ? await partnersRepo.findById(header.partnerId) : null;

    const targetToEmails = recipientEmail.trim();
    const samplePartnerName = `${partner?.name || ""} 御中`;

    const replacedSubject = mailTemplate.subjectTemplate
      .replace(/{company_name}/g, partner?.name || "御中")
      .replace(/{doc_id}/g, header.id);

    let replacedBody = mailTemplate.bodyTemplate
      .replace(/{company_name}/g, samplePartnerName)
      .replace(/{doc_id}/g, header.id);
    replacedBody = appendOrInjectDownloadLink(replacedBody, systemConfig, header.id);

    await enqueueNotification({
      dbLog: c.env.DB_LOG,
      type: "email",
      category: "delivery_note",
      documentId: header.id,
      recipientTo: targetToEmails,
      recipientCc: mailTemplate.ccAddress,
      smtpFromOverride: mailTemplate.smtpFrom?.trim() || null,
      subject: replacedSubject,
      body: replacedBody,
      performedById: header.createdBy || fallbackOperatorId || "UNKNOWN",
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXECUTE_SINGLE_SEND_DELIVERY_NOTE_EMAIL", RESOURCE_KEY, "SINGLE", null, {
        shipmentHeaderId,
        recipientEmail,
      }),
    );

    return {
      success: true,
      message: `宛先「${targetToEmails}」へのメール送信を予約しました`,
    };
  }
}
