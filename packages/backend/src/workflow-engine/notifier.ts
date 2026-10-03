import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import { enqueueNotification } from "../platform/notifications/enqueue-notification";
import { getCompanySettings } from "../platform/kv/company-settings-cache";

interface WorkflowMailOptions {
  c: Context;
  category: "workflow_request" | "workflow_result";
  documentId: string;
  to: string;
  cc?: string;
  subject: string;
  text: string;
  performedById: string;
}

/**
 * 承認ワークフロー通知。宛先ユーザーの通知方法設定が'slack'かつSlackメンバーID設定済みの
 * 場合はSlack DMのみをPENDING登録し、それ以外(既定の'email'、または'slack'選択でも
 * SlackメンバーID未設定=メールへフォールバック)の宛先のみメールをPENDING登録する。
 * (追加要望C対応、2026-08-16バグ確定・2026-09-16修正: 以前はメールが常に全員へ、
 * Slackは追加でのみ送られていたため、'slack'選択済みユーザーにはメールとSlackの両方が
 * 届いてしまっていた)
 */
export async function sendWorkflowMail(options: WorkflowMailOptions) {
  const { c, category, documentId, to, cc, subject, text, performedById } =
    options;

  const { mailTo, slackUserIds } = await splitBySlackPreference(c, to);

  if (mailTo) {
    await enqueueNotification({
      dbLog: c.env.DB_LOG,
      type: "email",
      category,
      documentId,
      recipientTo: mailTo,
      recipientCc: cc,
      subject,
      body: text,
      performedById,
    });
  }

  for (const slackUserId of slackUserIds) {
    await enqueueNotification({
      dbLog: c.env.DB_LOG,
      type: "slack",
      category,
      documentId,
      recipientTo: slackUserId,
      subject,
      body: text,
      performedById,
    });
  }
}

/**
 * 承認申請の新規提出時、第1承認者へ通知するための共通処理。
 * approvals.service.ts(マスタ用)・quote.service.ts(見積用、Item4-e)の双方から呼ばれる
 * (approvals.service.ts経由でregistry.ts→各adapterへ循環importするのを避けるため、
 * このメール送信部分だけをここへ切り出して共有する)。
 */
export async function notifyApprovalRequestSubmitted(options: {
  c: Context;
  requestId: string;
  approverEmails: string[];
  comment?: string | null;
  performedById: string;
}) {
  const { c, requestId, approverEmails, comment, performedById } = options;
  if (approverEmails.length === 0) return;

  const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
  const rawBaseUrl = systemConfig.site_url || c.env.FRONTEND_BASE_URL || "";
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const approvalLink = `${baseUrl}/workflow/tasks`;

  const mailSubject = `【承認依頼】申請のお知らせ`;
  const mailBody =
    `承認担当者 各位\n\n` +
    `新しい承認依頼が申請されました。\n` +
    `内容を確認の上、以下のリンクより承認対応を行ってください。\n\n` +
    `■ 申請コメント:\n${comment || "なし"}\n\n` +
    `----------------------------------------\n` +
    `▼ 承認画面リンク:\n` +
    `${approvalLink}\n` +
    `----------------------------------------\n`;

  await sendWorkflowMail({
    c,
    category: "workflow_request",
    documentId: requestId,
    to: approverEmails.join(", "),
    subject: mailSubject,
    text: mailBody,
    performedById,
  });
}

/**
 * カンマ区切りのメール宛先を、Slack DM対象(notification_channel='slack'かつ
 * slack_user_id設定済み)とメール宛先(それ以外)に振り分ける。
 * Slack宛先解決に失敗した場合は、通知自体を失わないよう全員をメール宛先として扱う
 * (従来のenqueueSlackForEmailRecipients()のフォールバック方針を踏襲)。
 */
async function splitBySlackPreference(
  c: Context,
  to: string,
): Promise<{ mailTo: string; slackUserIds: string[] }> {
  const entries = to
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return { mailTo: to, slackUserIds: [] };

  try {
    const db = drizzle(c.env.DB, { schema });
    const emails = entries.map((e) => e.toLowerCase());
    const targets = await db
      .select({
        email: schema.users.email,
        slackUserId: schema.users.slackUserId,
        notificationChannel: schema.users.notificationChannel,
      })
      .from(schema.users)
      .where(inArray(schema.users.email, emails));

    const slackEmails = new Set<string>();
    const slackUserIds: string[] = [];
    for (const target of targets) {
      if (target.notificationChannel === "slack" && target.slackUserId) {
        slackEmails.add(target.email.toLowerCase());
        slackUserIds.push(target.slackUserId);
      }
    }

    const mailTo = entries
      .filter((e) => !slackEmails.has(e.toLowerCase()))
      .join(", ");

    return { mailTo, slackUserIds };
  } catch (err) {
    // Slack宛先解決の失敗で通知自体を失わないよう、全員をメール宛先として扱う
    console.error(`[WorkflowSlackResolveError]`, err);
    return { mailTo: to, slackUserIds: [] };
  }
}
