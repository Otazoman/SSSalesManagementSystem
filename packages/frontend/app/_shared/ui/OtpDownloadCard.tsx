"use client";

import {
  useOtpDownload,
  type UseOtpDownloadOptions,
} from "../hooks/use-otp-download";
import { MessageBanner } from "./MessageBanner";
import {
  PublicCard,
  PublicField,
  publicButtonClass,
  publicInputClass,
} from "./PublicCard";

interface OtpDownloadCardProps extends UseOtpDownloadOptions {
  /** 例: "📋 注文請書ダウンロード" */
  title: string;
}

/**
 * 取引先・仕入先向けの公開ダウンロード画面(メールアドレス→確認コード→ダウンロード)。
 * <PublicPage> の中に置いて使う。画面ごとの差は props(title・API・ID名・ファイル名)だけ。
 */
export function OtpDownloadCard({ title, ...options }: OtpDownloadCardProps) {
  const {
    missingParams,
    step,
    email,
    setEmail,
    otp,
    setOtp,
    error,
    message,
    loading,
    downloadUrl,
    fileName,
    handleRequestOtp,
    handleVerifyOtp,
    handleBackToEmail,
  } = useOtpDownload(options);

  const description =
    step === "email"
      ? "ご登録のメールアドレスを入力してください。確認コードをお送りします。"
      : step === "otp"
        ? "メールに記載された確認コードを入力してください。"
        : "ダウンロードの準備ができました。";

  return (
    <PublicCard title={title} description={description}>
      <MessageBanner
        warning={
          missingParams
            ? "⚠️ URLが不正です。メール本文のリンクから改めてアクセスしてください。"
            : undefined
        }
        error={error ? `⚠️ ${error}` : undefined}
        message={message && step === "otp" ? `✅ ${message}` : undefined}
      />

      {step === "email" && (
        <form onSubmit={handleRequestOtp} className="space-y-4">
          <PublicField label="メールアドレス">
            <input
              type="email"
              required
              disabled={missingParams}
              className={publicInputClass}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </PublicField>
          <button
            type="submit"
            disabled={loading || missingParams}
            className={publicButtonClass.primary}
          >
            {loading ? "送信中..." : "確認コードを送信する"}
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <PublicField label="確認コード">
            <input
              type="text"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              className={`${publicInputClass} tracking-widest text-center font-bold`}
              placeholder="0000"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </PublicField>
          <button
            type="submit"
            disabled={loading}
            className={publicButtonClass.primary}
          >
            {loading ? "確認中..." : "確認してダウンロード"}
          </button>
          <button
            type="button"
            onClick={handleBackToEmail}
            className={publicButtonClass.text}
          >
            メールアドレスを入力し直す
          </button>
        </form>
      )}

      {step === "done" && (
        <div className="space-y-4 text-center">
          <a
            href={downloadUrl}
            download={fileName}
            className={publicButtonClass.success}
          >
            💾 {fileName} をダウンロード
          </a>
          <p className="text-xs text-slate-600">
            ダウンロードが開始されない場合は上のボタンをクリックしてください。
          </p>
        </div>
      )}
    </PublicCard>
  );
}
