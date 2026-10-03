import { MailDeliveryLogRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getMailDeliveryStatus } from "../../../_shared/status/mail-delivery-status";

interface MailLogTableProps {
  logs: MailDeliveryLogRecord[];
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function MailLogTable({ logs, sortBy, sortDirection, sortKeys, onSortChange }: MailLogTableProps) {
  return (
    <DataTable
      columns={[
        { key: "performedAt", label: "送信日時", className: "w-40", sortable: true },
        { key: "documentId", label: "対象伝票", className: "w-32", sortable: true },
        { key: "recipientTo", label: "宛先 (To)", className: "w-52", sortable: true },
        { key: "subject", label: "メール件名 / 添付ファイル", className: "w-64", sortable: true },
        { key: "status", label: "ステータス", align: "center", className: "w-28", sortable: true },
        { key: "error", label: "配信エラーログ / 操作者" },
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
            {new Date(log.performedAt).toLocaleString("ja-JP")}
          </td>
          <td className="px-4 py-3">
            <div className="font-bold text-slate-900 font-mono">
              {log.documentId}
            </div>
            <div className="text-[10px] text-slate-600">
              {log.type === "slack" ? "💬 Slack" : "✉️ Email"}
              {" / "}
              {log.category === "sales_quote" ? "📊 見積書" : log.category}
            </div>
          </td>
          <td className="px-4 py-3 break-all font-sans font-semibold text-slate-700 max-w-[200px]">
            {log.recipientTo}
            {log.recipientCc && (
              <div
                className="text-[10px] text-slate-600 font-normal mt-0.5 truncate"
                title={`CC: ${log.recipientCc}`}
              >
                CC: {log.recipientCc}
              </div>
            )}
          </td>
          <td className="px-4 py-3 max-w-[260px]">
            <div
              className="font-bold text-slate-800 truncate"
              title={log.subject}
            >
              {log.subject}
            </div>
            {log.attachedR2Path && (
              <div
                className="text-[10px] text-indigo-600 font-mono mt-0.5 truncate flex items-center gap-1"
                title={log.attachedR2Path}
              >
                <span>📎</span> <span>{log.attachedR2Path.split("/").pop()}</span>
              </div>
            )}
          </td>
          <td className="px-4 py-3 text-center">
            <StatusBadge {...getMailDeliveryStatus(log.status)} />
          </td>
          <td className="px-4 py-3">
            {log.status === "FAILED" ? (
              <div className="text-[10px] font-mono text-rose-600 bg-rose-50/50 p-2 border border-rose-100 rounded leading-normal max-w-[340px]">
                {log.errorMessage || "SMTPタイムアウト、または接続拒否"}
              </div>
            ) : log.status === "SUCCESS" ? (
              <div className="text-slate-600 italic text-[11px]">
                正常にリレー完了しました
              </div>
            ) : (
              <div className="text-amber-600 italic text-[11px]">
                {log.status === "PROCESSING"
                  ? "送信処理中です"
                  : "送信待ち(次回Cron実行時に送信されます)"}
              </div>
            )}
            <div className="text-[10px] text-slate-600 font-mono mt-1">
              実行オペレーター:{" "}
              <span className="font-bold text-slate-700">
                {log.performedById}
              </span>
            </div>
          </td>
        </tr>
      )}
    />
  );
}
