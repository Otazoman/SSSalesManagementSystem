import { useState, useCallback } from "react";

interface UseCsvDownloadOptions {
  /** ダウンロードファイル名（拡張子.csvは自動付与しないため呼び出し側で含める） */
  fileNamePrefix: string;
  /** 失敗時に呼ばれる。呼び出し側が既に持つmessage/error stateへそのまま渡せるようにコールバック形式にしている */
  onError?: (message: string) => void;
}

/**
 * CSVダウンロード実装（既存で3方式併存：blob方式／text+手動BOM付与方式／JSON API+JS内CSV組み立て方式）
 * のうち、最も広く使われているblob方式に統一する共通hook。新設のみ行い、
 * 既存3方式の解消（置き換え）はPhase4で該当featureに触れる際に行う。
 */
export function useCsvDownload({ fileNamePrefix, onError }: UseCsvDownloadOptions) {
  const [downloading, setDownloading] = useState(false);

  const download = useCallback(
    async (url: string) => {
      setDownloading(true);
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error("CSVのダウンロードに失敗しました");

        const blob = await res.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `${fileNamePrefix}_${Date.now()}.csv`;
        a.click();
        window.URL.revokeObjectURL(objectUrl);
      } catch (err) {
        if (err instanceof Error) onError?.(err.message);
      } finally {
        setDownloading(false);
      }
    },
    [fileNamePrefix, onError],
  );

  return { download, downloading };
}
