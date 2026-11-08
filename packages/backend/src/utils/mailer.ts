import { createTransport } from "nodemailer";
import net from "node:net";
import tls from "node:tls";

// 💡 添付ファイルの構造体定義
interface Attachment {
  filename: string;
  contentType: string;
  base64Content: string; // Cloudflare Workers上ではBase64文字列で扱うのが最も軽量で安全
}

// 💡 複数宛先・CC・BCC・HTML・添付ファイルに対応した汎用オプション
interface MailOptions {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  to: string | string[]; // 複数指定（配列 or カンマ区切り文字列）に対応
  cc?: string | string[]; // 任意指定
  bcc?: string | string[]; // 任意指定
  subject: string;
  text?: string; // テキスト本文（省略可能）
  html?: string; // HTML本文（追加拡張用）
  attachments?: Attachment[]; // 添付ファイル配列
}

interface CompanyConfig {
  company_name: string;
  site_url: string;
  is_audit_log_enabled: boolean;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
}

// 配列または文字列から、トリミング済みのクリーンなアドレス配列を返す補助関数
function parseAddresses(input: string | string[] | undefined): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((a) => a.trim()).filter(Boolean);
  return input
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

// SMTP通信全体(接続〜QUIT)のタイムアウト(ms)。相手サーバーが応答不能になった場合、
// 送信が無期限に待ち続けると、Cron Trigger(processNotificationOutbox)のctx.waitUntil()が永久に解決しなくなる。
// 1件のメール送信のハングがoutbox全体(ひいては同一tick内の他のスケジュールタスクも巻き込む)を
// 停止させないよう、送信処理全体(再送を含む)に上限を設ける
const SMTP_TIMEOUT_MS = 30_000;
// BUG-072: 一時的なエラー(4xx・接続の失敗)の再送の待ち時間(ms)。最大2回まで再送する。
// これでも失敗した場合は、通知キュー(processNotificationOutbox)の再送(1分おき)に任せる
const SMTP_RETRY_DELAYS_MS = [2_000, 5_000];
// 接続・応答待ちの上限(ms)。全体の上限(SMTP_TIMEOUT_MS)の中で再送できるよう短めにする
const SMTP_CONNECTION_TIMEOUT_MS = 8_000;
const SMTP_SOCKET_TIMEOUT_MS = 15_000;

/**
 * BUG-072: SMTP の送受信は nodemailer に任せる(Cloudflare Workers では nodejs_compat で動く)。
 * 465 は接続時から TLS、それ以外(587 など)は STARTTLS を必須にする(パスワードを暗号化せずに送らないため)。
 * 本文のエスケープ・改行・日本語の件名とファイル名のエンコードは nodemailer が行う。
 */
export function buildSmtpTransportOptions(smtpHost: string, smtpPort: string, smtpUser: string, smtpPass: string) {
  const host = smtpHost.trim() || "smtp.gmail.com";
  const port = parseInt(smtpPort.trim() || "465", 10);
  const secure = port === 465;
  return {
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      // BUG-072(Staging で確認): 認証方式は、以前の自前の処理で実績のある LOGIN にする(nodemailer は既定で
      // サーバーが示す先頭の方式(ASAHIネットでは PLAIN)を選び、ASAHIネットで 535 になった)
      method: "LOGIN",
      user: smtpUser.trim(),
      // Gmail のアプリパスワードは4文字ごとの空白付きで表示されるため、空白を除く(従来どおり)
      pass: smtpPass.replace(/\s/g, ""),
    },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    getSocket: connectByHostname(host, port, secure),
  };
}

// BUG-072(Staging で確認): nodemailer は送信の前にホスト名を IP アドレスに変換して、その IP アドレスへ接続する。
// Cloudflare Workers では IP アドレスを指定した接続が失敗する(ASAHIネットの 465/587・Gmail の 465 で
// 「proxy request failed, cannot connect to the specified address」・タイムアウト)ため、ホスト名のまま接続した
// ソケットを nodemailer に渡す(SMTP の受け答え・STARTTLS・認証・送信は nodemailer が行う)。
// 465 は接続時から TLS にしたソケットを渡す(接続済みのソケットを後から TLS にする方法は Workers では失敗するため)
function connectByHostname(host: string, port: number, secure: boolean) {
  return (
    _options: unknown,
    callback: (err: Error | null, socketOptions?: { connection: net.Socket; secured?: boolean }) => void,
  ) => {
    let settled = false;
    const done = (err: Error | null, socketOptions?: { connection: net.Socket; secured?: boolean }) => {
      if (settled) return;
      settled = true;
      callback(err, socketOptions);
    };
    const onError = (err: Error) => done(Object.assign(err, { code: (err as { code?: string }).code ?? "ECONNECTION" }));
    if (secure) {
      const socket = tls.connect({ host, port, servername: host });
      socket.once("secureConnect", () => done(null, { connection: socket, secured: true }));
      socket.once("error", onError);
      return;
    }
    const socket = net.connect({ host, port });
    socket.once("connect", () => done(null, { connection: socket }));
    socket.once("error", onError);
  };
}

type SmtpError = Error & { code?: string; responseCode?: number; response?: string };

// 一時的なエラー(サーバーの 4xx 応答・接続の失敗・応答待ちの時間切れ)だけ再送する。
// 認証の失敗(535)など 5xx は、再送しても結果が変わらないため再送しない
export function isRetryableSmtpError(err: unknown): boolean {
  const e = err as SmtpError;
  if (typeof e?.responseCode === "number") return e.responseCode >= 400 && e.responseCode < 500;
  return ["ECONNECTION", "ETIMEDOUT", "ESOCKET"].includes(e?.code ?? "");
}

// 送信ログに残すエラー文。接続先とサーバーの応答をそのまま残す(プロバイダに依らない文言にする)
export function describeSmtpError(err: unknown, host: string, port: number): string {
  const e = err as SmtpError;
  const target = `${host}:${port}`;
  const response = e?.response ? ` サーバー応答: ${e.response}` : "";
  switch (e?.code) {
    case "EAUTH":
      return `SMTPの認証に失敗しました(${target})。ユーザー名・パスワードを確認してください。${response}`;
    case "ECONNECTION":
    case "ESOCKET":
    case "EDNS":
      return `SMTPサーバーに接続できませんでした(${target})。ホスト名・ポート番号を確認してください。${e.message}`;
    case "ETIMEDOUT":
      return `SMTPサーバーからの応答が時間内にありませんでした(${target})。${e.message}`;
    case "EENVELOPE":
      return `送信元または宛先のアドレスがSMTPサーバーに拒否されました(${target})。${response || e.message}`;
    case "EMESSAGE":
      return `メッセージ本体の配送がSMTPサーバーに拒否されました(${target})。${response || e.message}`;
    default:
      return `メールの送信に失敗しました(${target})。${response || e?.message || String(err)}`;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 🚀 エンタープライズ対応：SMTP直接送信関数
 */
export async function sendEmail(options: MailOptions): Promise<void> {
  if (!options.smtpUser.trim() || !options.smtpPass.trim()) {
    throw new Error("SMTPのユーザー名またはパスワードが設定されていません");
  }
  const toList = parseAddresses(options.to);
  if (toList.length === 0) throw new Error("宛先(To)が指定されていません");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `SMTPサーバーからの応答が${SMTP_TIMEOUT_MS / 1000}秒以内に確認できませんでした(タイムアウト)`,
        ),
      );
    }, SMTP_TIMEOUT_MS);
  });

  try {
    await Promise.race([sendWithRetry(options, toList), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function sendWithRetry(options: MailOptions, toList: string[]): Promise<void> {
  const transportOptions = buildSmtpTransportOptions(
    options.smtpHost,
    options.smtpPort,
    options.smtpUser,
    options.smtpPass,
  );
  const senderEmail = options.smtpFrom.trim() || options.smtpUser.trim();
  const ccList = parseAddresses(options.cc);
  const bccList = parseAddresses(options.bcc);

  const transporter = createTransport(transportOptions);

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await transporter.sendMail({
          from: senderEmail,
          to: toList,
          ...(ccList.length > 0 ? { cc: ccList } : {}),
          ...(bccList.length > 0 ? { bcc: bccList } : {}),
          subject: options.subject,
          ...(options.text ? { text: options.text } : {}),
          ...(options.html ? { html: options.html } : {}),
          attachments: (options.attachments ?? []).map((attach) => ({
            filename: attach.filename,
            content: attach.base64Content,
            encoding: "base64",
            contentType: attach.contentType,
          })),
        });
        return;
      } catch (err) {
        if (attempt < SMTP_RETRY_DELAYS_MS.length && isRetryableSmtpError(err)) {
          await sleep(SMTP_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error(describeSmtpError(err, transportOptions.host, transportOptions.port));
      }
    }
  } finally {
    transporter.close();
  }
}

/**
 * 💡 自動マスタ解決ラッパー（拡張版）
 * 第3引数のコールバックで「拡張パラメータオブジェクト」を返せるように設計
 */
export async function sendSystemEmail(
  kvCloudflare: KVNamespace,
  to: string | string[],
  subject: string,
  contentBuilder: (
    siteUrl: string,
    companyName: string,
  ) => {
    text?: string;
    html?: string;
    cc?: string | string[];
    bcc?: string | string[];
    attachments?: Attachment[];
  },
): Promise<void> {
  const kvData = await kvCloudflare.get("config");
  if (!kvData) {
    throw new Error(
      "システム設定(config)がCloudflare KVに登録されていません",
    );
  }

  const config: CompanyConfig = JSON.parse(kvData);
  const siteUrl = (config.site_url || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const companyName = config.company_name || "販売管理システム";

  // コールバックを実行し、リッチなオブジェクトを取得
  const extras = contentBuilder(siteUrl, companyName);

  await sendEmail({
    smtpHost: config.smtp_host,
    smtpPort: config.smtp_port,
    smtpUser: config.smtp_user,
    smtpPass: config.smtp_pass,
    smtpFrom: config.smtp_from,
    to: to,
    cc: extras.cc,
    bcc: extras.bcc,
    subject: subject,
    text: extras.text,
    html: extras.html,
    attachments: extras.attachments,
  });
}
