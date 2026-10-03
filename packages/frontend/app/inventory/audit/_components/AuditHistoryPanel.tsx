"use client";

import { useRef, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { usePagePermissions } from "../../../hooks/use-page-permission";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { Pagination } from "../../../_shared/ui/Pagination";
import { StatusPillTabs } from "../../../_shared/ui/StatusPillTabs";
import { DataTable } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getApprovalResultStatus } from "../../../_shared/status/approval-result-status";
import { useAuditHistory } from "../_hooks/useAuditHistory";
import { AuditRecord } from "../_types";

const STATUS_OPTIONS = [
  { value: "", label: "🌐 すべて" },
  { value: "UNAPPROVED", label: "🟡 承認申請中" },
  { value: "APPROVED", label: "🟢 承認済み" },
  { value: "REMANDED", label: "🔴 差戻し" },
  { value: "CANCELED", label: "🔵 取下げ" },
];

const inputClass =
  "w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900";

interface AuditHistoryPanelProps {
  onEdit?: (auditId: string, audit: AuditRecord) => void;
}

export function AuditHistoryPanel({ onEdit }: AuditHistoryPanelProps) {
  const { isInventoryWfEnabled } = usePagePermissions();
  const { paginationEnabled } = usePaginationSetting();
  const history = useAuditHistory(paginationEnabled, true);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [message, setMessageState] = useState<{
    message?: string;
    error?: string;
  }>({});
  const [importing, setImporting] = useState(false);
  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "stock_audits_export",
    onError: (msg) => setMessageState({ error: msg }),
  });

  const handleCsvImportChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessageState({});
    setImporting(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target?.result;
      if (typeof csvText !== "string") {
        setImporting(false);
        return;
      }
      try {
        const data = await apiFetch<{ message?: string }>(
          `${history.baseUrl}/bulk-register`,
          {
            method: "POST",
            json: { csvData: csvText },
            defaultErrorMessage: "CSVインポートに失敗しました",
          },
        );
        setMessageState({
          message: data.message || "CSVインポートが成功しました",
        });
        void history.refetch();
      } catch (err: unknown) {
        setMessageState({
          error:
            err instanceof Error ? err.message : "CSVインポートに失敗しました",
        });
      } finally {
        setImporting(false);
        e.target.value = "";
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  return (
    <div className="space-y-4">
      <MessageBanner message={message.message} error={message.error} />

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              日付(From)
            </label>
            <input
              type="date"
              value={history.dateFrom}
              onChange={(e) => history.setDateFrom(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              日付(To)
            </label>
            <input
              type="date"
              value={history.dateTo}
              onChange={(e) => history.setDateTo(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">作成者</label>
            <select
              value={history.createdBy}
              onChange={(e) => history.setCreatedBy(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">🌐 すべて</option>
              {history.users.map((u) => (
                <option key={u.id} value={u.employeeNumber}>
                  {u.employeeNumber} ({u.name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">品目</label>
            <select
              value={history.itemId}
              onChange={(e) => history.setItemId(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">🌐 すべて</option>
              {history.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id} ({i.name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              ロケーション
            </label>
            <select
              value={history.locationId}
              onChange={(e) => history.setLocationId(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">🌐 すべて</option>
              {history.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={history.clearFilters}
            className="text-sm text-slate-600 hover:text-slate-800 font-bold cursor-pointer"
          >
            条件をクリア
          </button>
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <StatusPillTabs
          options={STATUS_OPTIONS}
          value={history.status}
          onChange={history.setStatus}
        />
        <div className="flex items-center space-x-3 shrink-0">
          <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
            該当件数:{" "}
            <span className="font-black text-indigo-600">{history.total}</span>{" "}
            件
          </span>
          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            disabled={importing || isInventoryWfEnabled}
            title={
              isInventoryWfEnabled
                ? "承認機能有効時はCSVインポートを利用できません"
                : undefined
            }
            className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {importing ? "インポート中..." : "📤 CSVインポート"}
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            disabled={importing || isInventoryWfEnabled}
            onChange={handleCsvImportChange}
          />
          <button
            type="button"
            onClick={() => void downloadCsv(history.csvDownloadUrl)}
            className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
          >
            📥 CSVダウンロード
          </button>
          <button
            type="button"
            onClick={() => void history.refetch()}
            className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
          >
            {history.loading ? "更新中..." : "🔄 再読込"}
          </button>
        </div>
      </div>

      <DataTable
        columns={[
          { key: "id", label: "ID", sortable: true },
          { key: "itemId", label: "品目", sortable: true },
          { key: "locationId", label: "ロケーション", sortable: true },
          {
            key: "theoreticalQuantity",
            label: "理論数量",
            align: "right",
            sortable: true,
          },
          {
            key: "countedQuantity",
            label: "実棚数量",
            align: "right",
            sortable: true,
          },
          {
            key: "differenceQuantity",
            label: "差異",
            align: "right",
            sortable: true,
          },
          { key: "memo", label: "差異理由・特記事項", sortable: true },
          { key: "status", label: "ステータス", sortable: true },
          { key: "createdBy", label: "作成者", sortable: true },
          { key: "actions", label: "" },
        ]}
        data={history.audits}
        loading={history.loading}
        emptyMessage="該当するデータはありません"
        sortBy={history.sortBy}
        sortDirection={history.sortDirection}
        sortKeys={history.sortKeys}
        onSortChange={history.setSort}
        renderRow={(a) => (
          <tr key={a.id} className="hover:bg-slate-50 text-sm">
            <td className="px-4 py-2 font-mono font-semibold">{a.id}</td>
            <td className="px-4 py-2 font-semibold">{a.itemId}</td>
            <td className="px-4 py-2">{a.locationId}</td>
            <td className="px-4 py-2 text-right">{a.theoreticalQuantity}</td>
            <td className="px-4 py-2 text-right font-bold">
              {a.countedQuantity}
            </td>
            <td
              className={`px-4 py-2 text-right font-bold ${
                a.differenceQuantity === 0
                  ? "text-slate-700"
                  : a.differenceQuantity > 0
                    ? "text-emerald-700"
                    : "text-red-600"
              }`}
            >
              {a.differenceQuantity > 0 ? "+" : ""}
              {a.differenceQuantity}
            </td>
            <td
              className="px-4 py-2 text-slate-600 max-w-xs truncate"
              title={a.memo || undefined}
            >
              {a.memo || "-"}
            </td>
            <td className="px-4 py-2">
              <StatusBadge {...getApprovalResultStatus(a.status)} />
            </td>
            <td className="px-4 py-2 text-slate-600">{a.createdBy}</td>
            <td className="px-4 py-2 text-right">
              {a.status === "REMANDED" && onEdit && (
                <Button
                  variant="success"
                  size="sm"
                  onClick={() => onEdit(a.id, a)}
                >
                  ✏️ 修正して再申請
                </Button>
              )}
            </td>
          </tr>
        )}
      />

      <Pagination
        paginationEnabled={paginationEnabled}
        page={history.page}
        totalPages={history.totalPages}
        total={history.total}
        limit={history.limit}
        onPageChange={history.setPage}
        onLimitChange={history.setLimit}
      />
    </div>
  );
}
