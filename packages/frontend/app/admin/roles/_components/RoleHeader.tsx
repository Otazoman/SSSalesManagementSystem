"use client";

interface RoleHeaderProps {
  canDownload: boolean;
  isSubmitting?: boolean;
  onDownloadCsv: () => void;
}

export function RoleHeader({
  canDownload,
  isSubmitting = false,
  onDownloadCsv,
}: RoleHeaderProps) {
  return (
    <div className="flex justify-between items-center border-b pb-4 border-slate-200">
      <div>
        <h1 className="text-2xl font-black text-slate-900">
          🛡️ 役職・ロールマスタ
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          承認ワークフローや画面アクセス権限に紐づく社内の役割・グループを一元管理します。
        </p>
      </div>
      <button
        onClick={onDownloadCsv}
        disabled={!canDownload || isSubmitting}
        className={`text-xs border px-3 py-1.5 rounded font-bold text-white transition-colors shadow-sm ${
          canDownload && !isSubmitting
            ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
            : "bg-slate-300 text-slate-500 border-slate-300 cursor-not-allowed"
        }`}
      >
        📥 CSVダウンロード
      </button>
    </div>
  );
}
