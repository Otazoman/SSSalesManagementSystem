"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

type Step = "email" | "otp" | "done";

export interface UseOtpDownloadOptions {
  /** 例: "/api/sales-orders"(下に /download-request/:id[/:attachmentId] と /download-verify/... を持つAPI) */
  apiBasePath: string;
  /** 対象IDを受け取るクエリパラメータ名(例: "orderId") */
  idParam: string;
  /** 例: "注文請書"(ファイル名が取得できない時の既定名: 注文請書_<ID>.pdf) */
  fileNamePrefix: string;
  /** 添付ファイルIDも必要か(既定true)。請求書のように1件につきPDFが1本のものは false */
  withAttachment?: boolean;
}

/**
 * メールアドレス入力→確認コード(OTP)→ダウンロード、の公開ダウンロード画面の共通ロジック。
 * 見積書・注文請書・発注書・検収書・売上関連書類・請求書のダウンロード画面で共通(差はAPIの場所・ID名・ファイル名のみ)。
 */
export function useOtpDownload({
  apiBasePath,
  idParam,
  fileNamePrefix,
  withAttachment = true,
}: UseOtpDownloadOptions) {
  const searchParams = useSearchParams();
  const targetId = searchParams.get(idParam) || "";
  const attachmentId = withAttachment
    ? searchParams.get("attachmentId") || ""
    : "";

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [fileName, setFileName] = useState("");

  const missingParams = !targetId || (withAttachment && !attachmentId);
  const idPath = withAttachment ? `${targetId}/${attachmentId}` : targetId;

  const handleRequestOtp = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (missingParams) {
      setError(
        "URLが不正です。メール本文のリンクから改めてアクセスしてください。",
      );
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBasePath}/download-request/${idPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(data.message || "送信に失敗しました");

      setMessage(
        data.message ||
          "入力されたメールアドレスが有効な場合、確認コードを送信しました。",
      );
      setStep("otp");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${apiBasePath}/download-verify/${idPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message || "確認コードの検証に失敗しました");
      }

      const contentDisposition = res.headers.get("Content-Disposition") || "";
      const nameMatch = contentDisposition.match(/filename\*=UTF-8''(.+)$/);
      const resolvedName = nameMatch
        ? decodeURIComponent(nameMatch[1])
        : `${fileNamePrefix}_${targetId}.pdf`;

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setDownloadUrl(objectUrl);
      setFileName(resolvedName);
      setStep("done");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBackToEmail = () => {
    setStep("email");
    setOtp("");
    setError("");
    setMessage("");
  };

  return {
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
  };
}
