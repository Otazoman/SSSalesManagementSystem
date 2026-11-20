import { drizzle } from "drizzle-orm/d1";
import { eq, and, or, isNull, lte, inArray, sql } from "drizzle-orm";
import * as auditSchema from "../db/audit-schema";
import * as mainSchema from "../db/schema";
import { Env } from "../types/env";
import { getCompanySettings } from "../platform/kv/company-settings-cache";
import { sendEmail } from "../utils/mailer";
import { sendSlackDirectMessage } from "../utils/slack";

const MAX_RETRY = 3;
const DEFAULT_BATCH_SIZE = 5;
// PERF-08: PROCESSING のままこの時間を過ぎた行は、送信の途中で処理が打ち切られたとみなして戻す
const STUCK_PROCESSING_MS = 5 * 60_000;

type MailDeliveryLogRow = typeof auditSchema.mailDeliveryLogs.$inferSelect;
type DbLog = ReturnType<typeof drizzle<typeof auditSchema>>;

/**
 * Item0: mail/Slack通知outbox(mailDeliveryLogs)の定期処理。Cron Trigger(1分間隔)から呼ばれる。
 * status='PENDING'の行をバッチ取得→email/Slackで実送信→結果をSUCCESS/FAILEDに反映する。
 * バッチサイズはCOMPANY_SETTINGS KVのconfig.mail_batch_sizeで調整可能(未設定時は5件)。
 */
export async function processNotificationOutbox(env: Env): Promise<void> {
  const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });
  const now = new Date();

  const systemConfig = (await getCompanySettings(env.COMPANY_SETTINGS)) || {};
  const parsedBatchSize = parseInt(
    String(systemConfig.mail_batch_size ?? DEFAULT_BATCH_SIZE),
    10,
  );
  const batchSize =
    Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
      ? parsedBatchSize
      : DEFAULT_BATCH_SIZE;

  await recoverStuckRows(dbLog, now);

  const pendingRows = await dbLog
    .select()
    .from(auditSchema.mailDeliveryLogs)
    .where(
      and(
        eq(auditSchema.mailDeliveryLogs.status, "PENDING"),
        or(
          isNull(auditSchema.mailDeliveryLogs.nextAttemptAt),
          lte(auditSchema.mailDeliveryLogs.nextAttemptAt, now),
        ),
      ),
    )
    .orderBy(auditSchema.mailDeliveryLogs.performedAt)
    .limit(batchSize);

  if (pendingRows.length === 0) return;

  // 同一行の二重送信を防ぐため、実送信前に先んじてPROCESSINGへ更新して「確保」する。
  // PERF-08: 登録の直後にすぐ送る処理(processNotificationById)と重なりうるため、PENDING の行だけを確保し、
  // 確保できた行だけを送る(以前は状態を見ずに PROCESSING にしていた)
  const claimedRows = await claimPendingRows(dbLog, pendingRows.map((r) => r.id), now);

  for (const row of claimedRows) {
    await deliverClaimedRow(env, dbLog, systemConfig, row);
  }
}

/**
 * PERF-08: 1件だけを定期処理を待たずに送る(OTP メールなど、すぐに届いてほしいもの)。
 * PENDING の行を確保できた時だけ送る(定期処理と同じ行を二重に送らない)。失敗した場合の再送は定期処理に任せる。
 */
export async function processNotificationById(env: Env, id: string): Promise<void> {
  const dbLog = drizzle(env.DB_LOG, { schema: auditSchema });
  const claimed = await claimPendingRows(dbLog, [id], new Date());
  if (claimed.length === 0) return;
  const systemConfig = (await getCompanySettings(env.COMPANY_SETTINGS)) || {};
  await deliverClaimedRow(env, dbLog, systemConfig, claimed[0]);
}

// PENDING の行だけを PROCESSING にして確保し、確保できた行を返す。nextAttemptAt には確保した時刻を入れる
// (PROCESSING のまま止まった行を見つけるのに使う。再送の時刻は、失敗の時に handleSendFailure が入れ直す)
async function claimPendingRows(
  dbLog: DbLog,
  ids: string[],
  now: Date,
): Promise<MailDeliveryLogRow[]> {
  if (ids.length === 0) return [];
  return await dbLog
    .update(auditSchema.mailDeliveryLogs)
    .set({ status: "PROCESSING", nextAttemptAt: now })
    .where(
      and(
        inArray(auditSchema.mailDeliveryLogs.id, ids),
        eq(auditSchema.mailDeliveryLogs.status, "PENDING"),
      ),
    )
    .returning();
}

async function deliverClaimedRow(
  env: Env,
  dbLog: DbLog,
  systemConfig: Record<string, any>,
  row: MailDeliveryLogRow,
): Promise<void> {
  try {
    if (row.type === "slack") {
      await sendSlackRow(systemConfig, row);
    } else {
      await sendEmailRow(env, systemConfig, row);
    }

    await dbLog
      .update(auditSchema.mailDeliveryLogs)
      .set({ status: "SUCCESS", errorMessage: null })
      .where(eq(auditSchema.mailDeliveryLogs.id, row.id));
  } catch (err) {
    await handleSendFailure(dbLog, row, err);
  }
}

/**
 * PERF-08: PROCESSING のまま5分以上たった行(送信の途中で処理が打ち切られたもの)を PENDING に戻す。
 * 打ち切りを繰り返す行で送信が終わらなくならないよう、再試行の回数に数え、上限に達したら FAILED にする。
 * 確保した時刻は nextAttemptAt(この修正より前に確保された行は登録の時刻)で判断する
 */
async function recoverStuckRows(dbLog: DbLog, now: Date): Promise<void> {
  const cutoffSeconds = Math.floor((now.getTime() - STUCK_PROCESSING_MS) / 1000);
  const stuckRows = await dbLog
    .select({ id: auditSchema.mailDeliveryLogs.id, retryCount: auditSchema.mailDeliveryLogs.retryCount })
    .from(auditSchema.mailDeliveryLogs)
    .where(
      and(
        eq(auditSchema.mailDeliveryLogs.status, "PROCESSING"),
        sql`coalesce(${auditSchema.mailDeliveryLogs.nextAttemptAt}, ${auditSchema.mailDeliveryLogs.performedAt}) <= ${cutoffSeconds}`,
      ),
    );
  const message = "送信の途中で処理が打ち切られたため、もう一度送ります";
  for (const row of stuckRows) {
    const nextRetryCount = (row.retryCount || 0) + 1;
    await dbLog
      .update(auditSchema.mailDeliveryLogs)
      .set(
        nextRetryCount >= MAX_RETRY
          ? { status: "FAILED", errorMessage: message, retryCount: nextRetryCount }
          : { status: "PENDING", errorMessage: message, retryCount: nextRetryCount, nextAttemptAt: now },
      )
      .where(
        and(
          eq(auditSchema.mailDeliveryLogs.id, row.id),
          eq(auditSchema.mailDeliveryLogs.status, "PROCESSING"),
        ),
      );
  }
}

async function handleSendFailure(
  dbLog: DbLog,
  row: MailDeliveryLogRow,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const nextRetryCount = (row.retryCount || 0) + 1;

  console.error(
    `[NotificationOutboxError] id=${row.id} type=${row.type} category=${row.category} attempt=${nextRetryCount}:`,
    message,
  );

  if (nextRetryCount >= MAX_RETRY) {
    await dbLog
      .update(auditSchema.mailDeliveryLogs)
      .set({
        status: "FAILED",
        errorMessage: message,
        retryCount: nextRetryCount,
      })
      .where(eq(auditSchema.mailDeliveryLogs.id, row.id));
    return;
  }

  // 2分・4分・8分...と間隔を空けて再試行する
  const backoffMinutes = 2 ** nextRetryCount;
  const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000);

  await dbLog
    .update(auditSchema.mailDeliveryLogs)
    .set({
      status: "PENDING",
      errorMessage: message,
      retryCount: nextRetryCount,
      nextAttemptAt,
    })
    .where(eq(auditSchema.mailDeliveryLogs.id, row.id));
}

async function sendSlackRow(
  systemConfig: Record<string, any>,
  row: MailDeliveryLogRow,
): Promise<void> {
  const botToken = systemConfig.slack_bot_token;
  if (!botToken) {
    throw new Error(
      "Slack Bot Tokenが設定されていません(company-settingsで設定してください)",
    );
  }
  await sendSlackDirectMessage(
    botToken,
    row.recipientTo,
    row.body || row.subject,
  );
}

async function sendEmailRow(
  env: Env,
  systemConfig: Record<string, any>,
  row: MailDeliveryLogRow,
): Promise<void> {
  const smtpFrom =
    row.smtpFrom || systemConfig.smtp_from || systemConfig.smtp_user;
  const attachments = await resolveAttachments(env, row);

  await sendEmail({
    smtpHost: systemConfig.smtp_host,
    smtpPort: systemConfig.smtp_port,
    smtpUser: systemConfig.smtp_user,
    smtpPass: systemConfig.smtp_pass,
    smtpFrom,
    to: row.recipientTo,
    cc: row.recipientCc || undefined,
    subject: row.subject,
    text: row.body || "",
    attachments,
  });
}

// 見積書PDF等のR2添付を、送信直前にここで読み込み・base64化する(enqueue時点では参照のみ保存)
async function resolveAttachments(env: Env, row: MailDeliveryLogRow) {
  if (!row.attachedR2Path) return undefined;

  const bucket = row.category === "sales_quote" ? env.QUATES_BUCKET : null;
  if (!bucket) return undefined;

  const obj = await bucket.get(row.attachedR2Path);
  if (!obj) return undefined;

  const buf = await obj.arrayBuffer();
  const uint8 = new Uint8Array(buf);
  let binStr = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binStr += String.fromCharCode.apply(
      null,
      uint8.subarray(i, i + chunkSize) as unknown as number[],
    );
  }

  const fileName = await resolveAttachmentFileName(env, row);

  return [
    {
      filename: fileName,
      contentType: "application/pdf",
      base64Content: btoa(binStr),
    },
  ];
}

async function resolveAttachmentFileName(
  env: Env,
  row: MailDeliveryLogRow,
): Promise<string> {
  if (row.category === "sales_quote" && row.attachedR2Path) {
    const db = drizzle(env.DB, { schema: mainSchema });
    const result = await db
      .select({ fileName: mainSchema.quoteAttachments.fileName })
      .from(mainSchema.quoteAttachments)
      .where(
        and(
          eq(mainSchema.quoteAttachments.quoteId, row.documentId),
          eq(mainSchema.quoteAttachments.attachmentR2Path, row.attachedR2Path),
        ),
      )
      .limit(1);
    if (result[0]?.fileName) return result[0].fileName;
  }
  return `${row.documentId}.pdf`;
}
