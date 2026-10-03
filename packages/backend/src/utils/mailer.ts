import { connect } from "cloudflare:sockets";

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
// ソケット読み取りループ(readResponse)には従来タイムアウトが無く無期限に待ち続けてしまい、
// Cron Trigger(processNotificationOutbox)のctx.waitUntil()が永久に解決しなくなる不具合があった。
// 1件のメール送信のハングがoutbox全体(ひいては同一tick内の他のスケジュールタスクも巻き込む)を
// 停止させないよう、送信処理全体に上限を設ける
const SMTP_TIMEOUT_MS = 30_000;

/**
 * 🚀 エンタープライズ対応：SMTP直接送信関数
 */
export async function sendEmail(options: MailOptions): Promise<void> {
  let socketRef: ReturnType<typeof connect> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      // タイムアウト時はソケットを強制クローズして接続を確実に解放する(ベストエフォート、
      // close()はPromiseを返すため同期try/catchでは拾えない失敗を.catch()で握りつぶす)
      socketRef?.close().catch(() => {});
      reject(
        new Error(
          `SMTPサーバーからの応答が${SMTP_TIMEOUT_MS / 1000}秒以内に確認できませんでした(タイムアウト)`,
        ),
      );
    }, SMTP_TIMEOUT_MS);
  });

  await Promise.race([performSmtpTransaction(options, (s) => (socketRef = s)), timeoutPromise]);
}

async function performSmtpTransaction(
  options: MailOptions,
  onSocketReady: (socket: ReturnType<typeof connect>) => void,
): Promise<void> {
  const {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    smtpFrom,
    subject,
    text,
    html,
    attachments,
  } = options;

  const host = smtpHost.trim() || "smtp.gmail.com";
  const port = parseInt(smtpPort.trim() || "465", 10);
  const senderEmail = smtpFrom.trim() || smtpUser.trim();

  if (!smtpUser.trim() || !smtpPass.trim()) {
    throw new Error(
      "Gmailのユーザー名または16桁アプリパスワードが設定されていません",
    );
  }

  // 宛先グループの解析
  const toList = parseAddresses(options.to);
  const ccList = parseAddresses(options.cc);
  const bccList = parseAddresses(options.bcc);

  if (toList.length === 0) throw new Error("宛先(To)が指定されていません");

  // 💡 SMTPの「RCPT TO」に流し込むための全配送先リスト（BCC含む）
  const allRecipients = [...toList, ...ccList, ...bccList];

  // MIMEヘッダー用の文字列を作成
  const toHeader = toList.join(", ");
  const ccHeader = ccList.length > 0 ? ccList.join(", ") : undefined;
  const base64Subject = btoa(
    String.fromCharCode(...new TextEncoder().encode(subject)),
  );

  // MIMEマルチパートのバウンダリ生成（テキスト/HTML/添付ファイルの切り分け用）
  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, "")}`;

  // MIMEメッセージ組み立て
  const mimeParts: string[] = [`From: <${senderEmail}>`, `To: ${toHeader}`];
  if (ccHeader) mimeParts.push(`Cc: ${ccHeader}`);
  mimeParts.push(`Subject: =?UTF-8?B?${base64Subject}?=`);
  mimeParts.push(`MIME-Version: 1.0`);
  mimeParts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  mimeParts.push(``); // ヘッダーとボディの境界

  // --- ボディパート（Text / HTML） ---
  mimeParts.push(`--${boundary}`);
  mimeParts.push(
    `Content-Type: multipart/alternative; boundary="${boundary}_ALT"`,
  );
  mimeParts.push(``);

  if (text) {
    mimeParts.push(`--${boundary}_ALT`);
    mimeParts.push(`Content-Type: text/plain; charset=UTF-8`);
    mimeParts.push(`Content-Transfer-Encoding: 8bit`);
    mimeParts.push(``);
    mimeParts.push(text);
  }

  if (html) {
    mimeParts.push(`--${boundary}_ALT`);
    mimeParts.push(`Content-Type: text/html; charset=UTF-8`);
    mimeParts.push(`Content-Transfer-Encoding: 8bit`);
    mimeParts.push(``);
    mimeParts.push(html);
  }
  mimeParts.push(`--${boundary}_ALT--`);

  // --- 添付ファイルパート ---
  if (attachments && attachments.length > 0) {
    for (const attach of attachments) {
      mimeParts.push(`--${boundary}`);
      mimeParts.push(
        `Content-Type: ${attach.contentType}; name="=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(attach.filename)))}?="`,
      );
      mimeParts.push(`Content-Transfer-Encoding: base64`);
      mimeParts.push(
        `Content-Disposition: attachment; filename="=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(attach.filename)))}?="`,
      );
      mimeParts.push(``);
      // Base64は76文字ごとに改行を入れるのがMIMEの標準規格
      const formattedBase64 = attach.base64Content.replace(
        /(.{76})/g,
        "$1\r\n",
      );
      mimeParts.push(formattedBase64);
    }
  }

  mimeParts.push(`--${boundary}--`);
  const rawMessage = mimeParts.join("\r\n");

  // ソケット通信開始
  const secureTransportSetting =
    port === 465 ? ("on" as const) : ("off" as const);
  const socket = connect(
    { hostname: host, port: port },
    { secureTransport: secureTransportSetting, allowHalfOpen: false },
  );
  onSocketReady(socket);

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // 💡 修正：SMTPサーバーの「応答完了サイン（4行目のスペースなど）」を検知したら、
  // 待ち続けずに即座にレスポンスを返して処理を次に進めます。
  async function readResponse(): Promise<string> {
    let result = "";
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        result += decoder.decode(value);
      }

      // SMTPプロトコルの規約準拠：応答コード（220, 250等）の直後に「スペース」が来たら、それがサーバーからの応答完了のサインです
      // 例: "250-smtp.gmail.com hello"\r\n "250 2.1.0 OK"\r\n <- 最後の行はハイフンではなくスペースになる
      if (done || /(^|\r\n)\d{3} .*\r\n$/.test(result)) {
        break;
      }
    }
    return result;
  }

  async function sendCommand(cmd: string): Promise<string> {
    await writer.write(encoder.encode(cmd + "\r\n"));
    return await readResponse();
  }

  try {
    await readResponse();
    await sendCommand(`EHLO localhost`);
    await sendCommand("AUTH LOGIN");
    await sendCommand(btoa(smtpUser.trim()));
    const authResult = await sendCommand(btoa(smtpPass.replace(/\s/g, "")));

    if (!authResult.includes("235")) {
      throw new Error(
        `GmailのSMTP認証に失敗しました。サーバー応答: ${authResult}`,
      );
    }

    // 配送コマンドの発行
    await sendCommand(`MAIL FROM:<${senderEmail}>`);

    // 💡 修正：To, Cc, Bcc すべての宛先に対して RCPT TO を発行する
    for (const rcpt of allRecipients) {
      await sendCommand(`RCPT TO:<${rcpt}>`);
    }

    // 1. DATAコマンドを送り、サーバーから「354 Start mail input」の受付返信を待つ
    const dataResponse = await sendCommand("DATA");
    if (!dataResponse.includes("354")) {
      throw new Error(
        `SMTP DATAコマンドが拒否されました。サーバー応答: ${dataResponse}`,
      );
    }

    // 2. 💡 修正：メッセージ本体（rawMessage）と終了の合図（\r\n.\r\n）をソケットへ生書き込みします
    await writer.write(encoder.encode(`${rawMessage}\r\n.\r\n`));

    // 3. 💡 修正：Gmailが巨大なPDFデータを読み込み、処理し終わって「250 OK」を返すまで、ここで100%確実に安全に待機します
    const mailResult = await readResponse();
    if (!mailResult.includes("250")) {
      throw new Error(
        `SMTPメッセージ本体の配送がサーバーに拒否されました。サーバー応答: ${mailResult}`,
      );
    }

    // 4. 正式にメールの受付（Queue格納）が完了したことを受けてから、安全にQUITを発行します
    await sendCommand("QUIT");
  } finally {
    writer.releaseLock();
    reader.releaseLock();
    // タイムアウト側で既に強制クローズ済みの場合、再度のclose()が例外を投げることがあるため、
    // 呼び出し元(Promise.race)には無関係な二重クローズの例外を伝播させない
    try {
      await socket.close();
    } catch {
      // 既にクローズ済み/エラー状態の場合は無視
    }
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
