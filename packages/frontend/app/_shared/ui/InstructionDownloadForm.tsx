"use client";

import { useInstructionDownload } from "../hooks/use-instruction-download";
import { MessageBanner } from "./MessageBanner";
import {
  PublicCard,
  PublicField,
  publicButtonClass,
  publicInputClass,
} from "./PublicCard";

interface InstructionDownloadFormProps {
  apiBasePath: string; // "/api/shipment-instructions" | "/api/receipt-instructions"
  title: string; // "出荷指示書ダウンロード" | "入荷指示書ダウンロード"
  fileNamePrefix: string; // "出荷指示書" | "入荷指示書"
}

// Item6 Phase6-4: 出荷指示書/入荷指示書のOTPダウンロードUI。OtpDownloadCardと同型だが、
// メールアドレス入力ステップを持たない(宛先は倉庫マスタ登録メールに固定)。<PublicPage>の中に置いて使う
export function InstructionDownloadForm({
  apiBasePath,
  title,
  fileNamePrefix,
}: InstructionDownloadFormProps) {
  const {
    missingParams,
    step,
    otp,
    setOtp,
    error,
    message,
    loading,
    downloadUrl,
    fileName,
    csvUrl,
    csvFileName,
    handleRequestOtp,
    handleVerifyOtp,
    handleBackToConfirm,
  } = useInstructionDownload({ apiBasePath, fileNamePrefix });

  const description =
    step === "confirm"
      ? "ご登録のメールアドレス宛に確認コードを送信します。下のボタンを押してください。"
      : step === "otp"
        ? "メールに記載された確認コードを入力してください。"
        : "ダウンロードの準備ができました。";

  return (
    <PublicCard title={`📄 ${title}`} description={description}>
      <MessageBanner
        warning={
          missingParams
            ? "⚠️ URLが不正です。メール本文のリンクから改めてアクセスしてください。"
            : undefined
        }
        error={error ? `⚠️ ${error}` : undefined}
        message={message && step === "otp" ? `✅ ${message}` : undefined}
      />

      {step === "confirm" && (
        <form onSubmit={handleRequestOtp} className="space-y-4">
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
            onClick={handleBackToConfirm}
            className={publicButtonClass.text}
          >
            コード送信をやり直す
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
          {csvUrl && (
            <a
              href={csvUrl}
              download={csvFileName}
              className={publicButtonClass.primary}
            >
              📊 {csvFileName} をダウンロード
            </a>
          )}
          <p className="text-xs text-slate-600">
            ダウンロードが開始されない場合は上のボタンをクリックしてください。
          </p>
        </div>
      )}
    </PublicCard>
  );
}
