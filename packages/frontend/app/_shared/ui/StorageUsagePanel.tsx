"use client";

// REQ-001: D1・R2 の使用容量の表示(DB/バケットごとの大きさと総容量)。R2 ファイル管理・D1 データ参照の画面で使う

/** バイト数を読みやすい単位で表す(GB まで) */
export function formatStorageBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export interface StorageUsageRow {
  key: string;
  label: string;
  sizeBytes: number | null;
  /** 補足(ファイル数・共有しているDBなど) */
  note?: string;
  error?: string;
}

interface StorageUsagePanelProps {
  title: string;
  rows: StorageUsageRow[] | null;
  totalBytes: number | null;
  totalNote?: string;
  loading: boolean;
  error?: string;
  /** 計算・再計算のボタン。onLoad を渡した時だけ出す */
  onLoad?: () => void;
  loadLabel?: string;
  description?: string;
}

export function StorageUsagePanel({
  title,
  rows,
  totalBytes,
  totalNote,
  loading,
  error,
  onLoad,
  loadLabel = "容量を計算",
  description,
}: StorageUsagePanelProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          {description && <p className="text-xs text-slate-600 mt-0.5">{description}</p>}
        </div>
        {onLoad && (
          <button
            type="button"
            onClick={onLoad}
            disabled={loading}
            className="px-4 py-1.5 text-xs font-bold border border-slate-400 rounded bg-white text-slate-800 hover:bg-slate-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "計算中..." : rows ? "再計算" : loadLabel}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {!onLoad && loading && <p className="text-xs text-slate-600">読み込み中...</p>}

      {rows && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-700">
                <th className="py-1.5 pr-3 font-bold">対象</th>
                <th className="py-1.5 pr-3 font-bold text-right">使用容量</th>
                <th className="py-1.5 font-bold">補足</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="py-1.5 pr-3">{row.label}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{formatStorageBytes(row.sizeBytes)}</td>
                  <td className="py-1.5 text-slate-700">
                    {row.error ? <span className="text-red-700">取得できませんでした: {row.error}</span> : row.note}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-bold text-slate-900">
                <td className="py-1.5 pr-3">総容量</td>
                <td className="py-1.5 pr-3 text-right font-mono">{formatStorageBytes(totalBytes)}</td>
                <td className="py-1.5 font-normal text-slate-700">{totalNote}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
