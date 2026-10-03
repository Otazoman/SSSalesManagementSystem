import { useState } from "react";
import { apiFetch } from "./use-api-fetch";
import { AttachmentRecord } from "../types/attachment";

interface UseAttachmentUploadOptions {
  /** アップロード先エンドポイント（例: "/api/partners/upload"） */
  uploadUrl: string;
  /** アップロード失敗時のエラー通知方法。feature側の既存UX（alert表示 or メッセージバナー表示）をそのまま渡す */
  onError?: (message: string) => void;
}

interface UploadResult {
  fileName: string;
  attachmentR2Path: string;
}

/**
 * 添付ファイルのR2アップロード処理（fetch・FormData組み立て・エラー処理・uploading状態管理）の共通化。
 * `partners`/`products`/`warehouses`で個別実装されていたが、`partners`は`credentials: "include"`が
 * 抜けていた（apiFetchベースのため本hook経由で自動的に是正される）。
 * 外部リンク追加（Google Drive判定の有無等、機能ごとに挙動が異なる）・添付ファイル一覧の表示は
 * 機能固有の実装のまま維持し、ここでは共通化しない。
 */
export function useAttachmentUpload<TFileType extends string = string>({
  uploadUrl,
  onError,
}: UseAttachmentUploadOptions) {
  const [uploading, setUploading] = useState(false);

  const uploadFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    fileType: TFileType,
  ): Promise<AttachmentRecord<TFileType> | null> => {
    const file = e.target.files?.[0];
    if (!file) return null;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await apiFetch<UploadResult>(uploadUrl, {
        method: "POST",
        body: formData,
        defaultErrorMessage: "アップロードに失敗しました",
      });

      return {
        fileName: data.fileName,
        storageType: "R2",
        attachmentR2Path: data.attachmentR2Path,
        fileType,
      };
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "アップロードに失敗しました");
      return null;
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return { uploading, uploadFile };
}
