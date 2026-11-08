import { describe, it, expect } from "vitest";
import { createTransport } from "nodemailer";
import {
  buildSmtpTransportOptions,
  describeSmtpError,
  isRetryableSmtpError,
  sendEmail,
} from "./mailer";

// BUG-072: SMTP の送受信を nodemailer に置き換えた。Workers(workerd)で動くこと、接続の設定、
// 再送するエラーの判定、エラー文(接続先とサーバーの応答を残し、プロバイダ名を固定で出さない)を確認する
describe("buildSmtpTransportOptions", () => {
  it("465 は接続時から TLS(secure)にする", () => {
    const options = buildSmtpTransportOptions("mail.example.com", "465", "user", "pass");
    expect(options).toMatchObject({ host: "mail.example.com", port: 465, secure: true, requireTLS: false });
  });

  it("587 は STARTTLS を必須にする(暗号化せずに認証しない)", () => {
    const options = buildSmtpTransportOptions("smtp.gmail.com", "587", "user", "pass");
    expect(options).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  // Staging で確認: Workers では IP アドレスを指定した接続が失敗するため、ホスト名のまま接続したソケットを nodemailer に渡す
  it("ホスト名のまま接続するソケットを nodemailer に渡す(getSocket)", () => {
    expect(typeof buildSmtpTransportOptions("mail.example.com", "465", "u", "p").getSocket).toBe("function");
  });

  it("パスワードの空白(Gmail のアプリパスワードの区切り)を除く", () => {
    const options = buildSmtpTransportOptions("smtp.gmail.com", "465", " user@example.com ", "abcd efgh ijkl mnop");
    // 認証方式は、以前の自前の処理で実績のある LOGIN(BUG-072)
    expect(options.auth).toEqual({ method: "LOGIN", user: "user@example.com", pass: "abcdefghijklmnop" });
  });
});

describe("isRetryableSmtpError", () => {
  it("サーバーの 4xx 応答(一時的な拒否)は再送する", () => {
    expect(isRetryableSmtpError(Object.assign(new Error("deferred"), { responseCode: 421 }))).toBe(true);
  });

  it("サーバーの 5xx 応答(認証の失敗など)は再送しない", () => {
    expect(isRetryableSmtpError(Object.assign(new Error("auth"), { code: "EAUTH", responseCode: 535 }))).toBe(false);
  });

  it("接続の失敗・時間切れは再送する", () => {
    expect(isRetryableSmtpError(Object.assign(new Error("x"), { code: "ECONNECTION" }))).toBe(true);
    expect(isRetryableSmtpError(Object.assign(new Error("x"), { code: "ETIMEDOUT" }))).toBe(true);
  });
});

describe("describeSmtpError", () => {
  it("認証の失敗は、接続先とサーバーの応答を残し、プロバイダ名を固定で出さない", () => {
    const message = describeSmtpError(
      Object.assign(new Error("Invalid login"), {
        code: "EAUTH",
        responseCode: 535,
        response: "535 5.7.8 Authentication failed.",
      }),
      "mail.example.com",
      465,
    );
    expect(message).toContain("mail.example.com:465");
    expect(message).toContain("535 5.7.8 Authentication failed.");
    expect(message).not.toContain("Gmail");
  });
});

describe("sendEmail の入力チェック", () => {
  const base = {
    smtpHost: "mail.example.com",
    smtpPort: "465",
    smtpUser: "user",
    smtpPass: "pass",
    smtpFrom: "from@example.com",
    to: "to@example.com",
    subject: "件名",
  };

  it("ユーザー名・パスワードが無ければ送らずにエラーにする(プロバイダ名を出さない)", async () => {
    await expect(sendEmail({ ...base, smtpPass: "" })).rejects.toThrow(
      "SMTPのユーザー名またはパスワードが設定されていません",
    );
  });

  it("宛先が無ければ送らずにエラーにする", async () => {
    await expect(sendEmail({ ...base, to: [] })).rejects.toThrow("宛先(To)が指定されていません");
  });
});

describe("nodemailer が Workers で動くこと", () => {
  it("日本語の件名・添付ファイル付きのメッセージを組み立てられる", async () => {
    const transporter = createTransport({ streamTransport: true, buffer: true, newline: "windows" });
    const info = await transporter.sendMail({
      from: "from@example.com",
      to: ["to@example.com"],
      subject: "【御中】検収書のご送付について",
      text: "本文\n.で始まる行",
      attachments: [
        { filename: "検収書.pdf", content: btoa("%PDF-1.4"), encoding: "base64", contentType: "application/pdf" },
      ],
    });
    const raw = String(info.message);
    expect(raw).toContain("Subject: =?UTF-8?");
    expect(raw).toContain("application/pdf");
    expect(raw).toContain("\r\n");
  });
});
