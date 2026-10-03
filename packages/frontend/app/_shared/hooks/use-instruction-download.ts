"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

type Step = "confirm" | "otp" | "done";

interface UseInstructionDownloadOptions {
  // "/api/shipment-instructions" | "/api/receipt-instructions"
  apiBasePath: string;
  fileNamePrefix: string; // "出荷指示書" | "入荷指示書"
}

// Item6 Phase6-4: 出荷指示書/入荷指示書のOTPダウンロード。quote-download/_hooks/useQuoteDownload.tsと
// 同じ3ステップ構成だが、宛先メールアドレスは倉庫マスタ登録メールへ固定されるため
// (ユーザー確認済み)、受信者がメールアドレスを入力する最初のステップが不要
// ("confirm"=コード送信ボタンのみ→"otp"=コード入力→"done")
export function useInstructionDownload({ apiBasePath, fileNamePrefix }: UseInstructionDownloadOptions) {
  const searchParams = useSearchParams();
  const instructionId = searchParams.get("instructionId") || "";
  const attachmentId = searchParams.get("attachmentId") || "";

  const [step, setStep] = useState<Step>("confirm");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [csvUrl, setCsvUrl] = useState("");
  const [csvFileName, setCsvFileName] = useState("");

  const missingParams = !instructionId || !attachmentId;

  const handleRequestOtp = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (missingParams) {
      setError("URLが不正です。メール本文のリンクから改めてアクセスしてください。");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBasePath}/download-request/${instructionId}/${attachmentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(data.message || "送信に失敗しました");

      setMessage(data.message || "登録済みのメールアドレス宛に確認コードを送信しました");
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
      const res = await fetch(`${apiBasePath}/download-verify/${instructionId}/${attachmentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        fileName?: string;
        contentType?: string;
        fileBase64?: string;
        csv?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.message || "確認コードの検証に失敗しました");
      }

      const resolvedName = data.fileName || `${fileNamePrefix}_${instructionId}.pdf`;
      const binaryString = atob(data.fileBase64 || "");
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: data.contentType || "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);
      setDownloadUrl(objectUrl);
      setFileName(resolvedName);

      if (data.csv) {
        const csvBlob = new Blob([data.csv], { type: "text/csv; charset=utf-8" });
        const csvObjectUrl = URL.createObjectURL(csvBlob);
        setCsvUrl(csvObjectUrl);
        setCsvFileName(`${fileNamePrefix}データ_${instructionId}.csv`);
      }

      setStep("done");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBackToConfirm = () => {
    setStep("confirm");
    setOtp("");
    setError("");
    setMessage("");
  };

  return {
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
  };
}
