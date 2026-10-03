"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { R2BucketOption, R2ListResult, R2ExplorerItem } from "../_types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

// Item13-a: R2参照機能。既存のR2ExplorerModal(admin/mail-settings、フォント/ロゴ選択用の
// system/quotesバケット限定ピッカー)とは別に、全バケットを横断してブラウズ・削除・リネームできる
// 独立画面用のhook。ナビゲーション(フォルダを開く/上へ戻る)の考え方はR2ExplorerModalを踏襲する
export function useR2Explorer() {
  const confirm = useConfirm();
  const [buckets, setBuckets] = useState<R2BucketOption[]>([]);
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [result, setResult] = useState<R2ListResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<R2BucketOption[]>("/api/r2-explorer/buckets");
        setBuckets(data);
        if (data.length > 0) setBucket(data[0].key);
      } catch (err) {
        setError(err instanceof Error ? err.message : "バケット一覧の取得に失敗しました");
      }
    })();
  }, []);

  const fetchObjects = useCallback(async (targetBucket: string, targetPrefix: string) => {
    if (!targetBucket) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ bucket: targetBucket, prefix: targetPrefix });
      const data = await apiFetch<R2ListResult>(`/api/r2-explorer/objects?${params.toString()}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ファイル一覧の取得に失敗しました");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!bucket) return;
    void (async () => {
      await fetchObjects(bucket, prefix);
    })();
  }, [bucket, prefix, fetchObjects]);

  const handleSelectBucket = (key: string) => {
    setBucket(key);
    setPrefix("");
  };

  const handleOpenFolder = (item: R2ExplorerItem) => {
    if (item.type !== "folder") return;
    setPrefix(item.path);
  };

  const handleNavigateUp = () => {
    if (result?.parentPrefix != null) setPrefix(result.parentPrefix);
  };

  const handleDelete = async (item: R2ExplorerItem) => {
    if (item.type !== "file") return false;
    if (!(await confirm(`ファイル [ ${item.name} ] を削除しますか？\nこの操作は取り消せません。`))) return false;

    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ message?: string }>("/api/r2-explorer/objects/delete", {
        method: "POST",
        json: { bucket, key: item.path },
        defaultErrorMessage: "ファイルの削除に失敗しました",
      });
      setMessage(data.message || "ファイルを削除しました");
      await fetchObjects(bucket, prefix);
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    }
  };

  const handleRename = async (item: R2ExplorerItem, newName: string) => {
    if (item.type !== "file") return false;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === item.name) return false;

    const newKey = item.path.slice(0, item.path.length - item.name.length) + trimmed;

    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ message?: string }>("/api/r2-explorer/objects/rename", {
        method: "POST",
        json: { bucket, oldKey: item.path, newKey },
        defaultErrorMessage: "ファイル名の変更に失敗しました",
      });
      setMessage(data.message || "ファイル名を変更しました");
      await fetchObjects(bucket, prefix);
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    }
  };

  // 追加要望L-3-d: ダウンロード(認証付きfetch→Blob→保存)。日本語ファイル名はitem.nameをそのまま使う
  const handleDownload = async (item: R2ExplorerItem) => {
    if (item.type !== "file") return;
    setError("");
    setMessage("");
    try {
      const params = new URLSearchParams({ bucket, key: item.path });
      const res = await fetch(`/api/r2-explorer/objects/download?${params.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message || "ダウンロードに失敗しました");
      }
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = item.name;
      a.click();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  // 追加要望L-3-d: アップロード。同名ファイルがある場合は確認のうえ、上書き指定で再送する
  const handleUpload = async (file: File) => {
    setError("");
    setMessage("");
    const send = async (overwrite: boolean) => {
      const form = new FormData();
      form.set("bucket", bucket);
      form.set("prefix", prefix);
      form.set("file", file);
      if (overwrite) form.set("overwrite", "true");
      return apiFetch<{ message?: string }>("/api/r2-explorer/objects/upload", {
        method: "POST",
        body: form,
        defaultErrorMessage: "アップロードに失敗しました",
      });
    };
    try {
      let data;
      try {
        data = await send(false);
      } catch (err) {
        if (err instanceof Error && err.message.includes("同名のファイルが既に存在")) {
          if (!(await confirm(`同名のファイル [ ${file.name} ] が既に存在します。上書きしますか？\nこの操作は取り消せません。`))) return false;
          data = await send(true);
        } else {
          throw err;
        }
      }
      setMessage(data.message || "アップロードしました");
      await fetchObjects(bucket, prefix);
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    }
  };

  return {
    buckets,
    bucket,
    prefix,
    result,
    loading,
    message,
    setMessage,
    error,
    setError,
    handleSelectBucket,
    handleOpenFolder,
    handleNavigateUp,
    handleDelete,
    handleRename,
    handleDownload,
    handleUpload,
  };
}
