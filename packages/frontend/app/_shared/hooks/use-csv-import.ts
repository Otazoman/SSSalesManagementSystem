import { useState, useCallback } from "react";

interface UseCsvImportOptions {
  /** インポート成功後に一覧を再取得するためのコールバック（呼び出し側のsync関数を渡す） */
  onSuccess?: () => void | Promise<void>;
  /** 成功時メッセージ。呼び出し側が既に持つmessage stateへそのまま渡せるようにコールバック形式にしている */
  onMessage?: (message: string) => void;
  /** 失敗時メッセージ */
  onError?: (message: string) => void;
}

/**
 * CSVインポート（multipart/form-data POST）の共通hook。
 * 既存の3方式併存しているCSV実装の解消（置き換え）はPhase4で該当featureに触れる際に行う。
 */
export function useCsvImport({ onSuccess, onMessage, onError }: UseCsvImportOptions = {}) {
  const [importing, setImporting] = useState(false);

  const importCsv = useCallback(
    // REQ-024: 取込に成功したら true を返す(モーダルの画面は、成功した時だけ閉じる。今までの呼び出し側は戻り値を使っていない)
    async (url: string, e: React.ChangeEvent<HTMLInputElement>): Promise<boolean> => {
      const file = e.target.files?.[0];
      if (!file) return false;

      setImporting(true);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch(url, {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "インポートに失敗しました");

        onMessage?.(data.message || "インポートが完了しました");
        await onSuccess?.();
        return true;
      } catch (err) {
        if (err instanceof Error) onError?.(err.message);
        return false;
      } finally {
        e.target.value = "";
        setImporting(false);
      }
    },
    [onSuccess, onMessage, onError],
  );

  return { importCsv, importing };
}
