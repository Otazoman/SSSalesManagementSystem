import { OtpDownloadLogRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";

interface OtpLogTableProps {
  logs: OtpDownloadLogRecord[];
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function OtpLogTable({ logs, sortBy, sortDirection, sortKeys, onSortChange }: OtpLogTableProps) {
  return (
    <DataTable
      columns={[
        { key: "createdAt", label: "OTP発行日時", className: "w-40", sortable: true },
        { key: "partner", label: "取引先 / 件名", className: "w-64" },
        { key: "email", label: "メールアドレス", className: "w-52", sortable: true },
        { key: "verifiedAt", label: "ダウンロード確認", align: "center", className: "w-44", sortable: true },
        { key: "attemptCount", label: "試行回数", align: "center", className: "w-20", sortable: true },
      ]}
      data={logs}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(log) => (
        <tr key={log.id} className="hover:bg-slate-50 transition-colors">
          <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap">
            {log.createdAt
              ? new Date(log.createdAt).toLocaleString("ja-JP")
              : "-"}
          </td>
          <td className="px-4 py-3 max-w-[280px]">
            <div className="font-bold text-slate-900 truncate" title={log.partnerName || undefined}>
              {log.partnerName || "不明な取引先"}
            </div>
            <div
              className="text-[10px] text-slate-500 truncate"
              title={log.quoteTitle || undefined}
            >
              {log.quoteTitle || "(件名なし)"}
            </div>
            <div className="text-[10px] text-slate-600 font-mono mt-0.5">
              {log.documentId}
            </div>
          </td>
          <td className="px-4 py-3 break-all font-sans font-semibold text-slate-700 max-w-[200px]">
            {log.email}
          </td>
          <td className="px-4 py-3 text-center">
            {log.verifiedAt ? (
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold border bg-emerald-50 text-emerald-700 border-emerald-100">
                  ✅ ダウンロード確認済み
                </span>
                <div className="text-[10px] text-slate-500 font-mono mt-1">
                  {new Date(log.verifiedAt).toLocaleString("ja-JP")}
                </div>
              </div>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold border bg-amber-50 text-amber-700 border-amber-100">
                未確認/失敗
              </span>
            )}
          </td>
          <td className="px-4 py-3 text-center font-mono font-bold text-slate-700">
            {log.attemptCount}
          </td>
        </tr>
      )}
    />
  );
}
