"use client";

import { Fragment, useRef, useState } from "react";
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
import {
  HistoryType,
  useInventoryHistory,
} from "../_hooks/useInventoryHistory";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import {
  ReceiptHeaderRecord,
  ReceiptItemRecord,
  ShipmentHeaderRecord,
  ShipmentItemRecord,
} from "../_types";

const LOCKED_TYPE_LABELS: Record<HistoryType, string> = {
  receipt: "📥 入庫履歴",
  shipment: "📤 出庫履歴",
};

const STATUS_OPTIONS = [
  { value: "", label: "🌐 すべて" },
  { value: "UNAPPROVED", label: "🟡 承認申請中" },
  { value: "APPROVED", label: "🟢 承認済み" },
  { value: "REMANDED", label: "🔴 差戻し" },
  { value: "CANCELED", label: "🔵 取下げ" },
];

const inputClass =
  "w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900";

// K-2-a: StockTable.tsxと同じ品質区分ラベル辞書(英語のまま表示されていたのを日本語表記に統一)
const QUALITY_LABELS: Record<string, string> = {
  NORMAL: "🟢 良品",
  DAMAGED: "🔴 破損品",
  QUARANTINE: "🟡 検品待ち",
};

// K-2-a: ReceiptScanPanel.tsxと同じ検品結果ラベル辞書
const INSPECTION_LABELS: Record<string, string> = {
  PASSED: "🟢 良品",
  DAMAGED: "🔴 破損",
  QUARANTINE: "🟡 検品待ち",
};

interface InventoryHistoryPanelProps {
  onEdit?: (
    type: "receipt" | "shipment",
    headerId: string,
    items: ReceiptItemRecord[] | ShipmentItemRecord[],
    partnerId: string | null,
    // 新規要望(2026-09-23): 倉庫間移動の移動元(入庫)/移動先(出庫)倉庫。未設定の場合はnull
    transferWarehouseId: string | null,
  ) => void;
  // 業務機能別ページ(入荷/出荷)から使う場合に指定する。指定時は入庫/出庫の切替ボタンを隠し、
  // 該当タイプに固定表示する(未指定時は従来通り両方を切替表示、既存呼び出し元は無変更)
  lockedType?: HistoryType;
}

export function InventoryHistoryPanel({
  onEdit,
  lockedType,
}: InventoryHistoryPanelProps) {
  const {
    isReceivingWfEnabled,
    isShippingWfEnabled,
    isReceivingResultWfEnabled,
    isShippingResultWfEnabled,
  } = usePagePermissions();
  const { paginationEnabled } = usePaginationSetting();
  const history = useInventoryHistory(
    paginationEnabled,
    true,
    lockedType ?? "receipt",
  );
  const csvInputRef = useRef<HTMLInputElement>(null);

  // 新規要望(2026-09-23): 倉庫間移動の相手倉庫(入庫=移動元、出庫=移動先)。未設定ならnull
  const transferWarehouseIdOf = (
    h: ReceiptHeaderRecord | ShipmentHeaderRecord,
  ): string | null =>
    history.historyType === "receipt"
      ? (h as ReceiptHeaderRecord).sourceWarehouseId
      : (h as ShipmentHeaderRecord).destinationWarehouseId;
  const warehouseLabel = (warehouseId: string) => {
    const warehouse = history.warehouses.find((w) => w.id === warehouseId);
    return warehouse ? `[${warehouse.id}] ${warehouse.name}` : warehouseId;
  };

  const [message, setMessageState] = useState<{
    message?: string;
    error?: string;
  }>({});
  const [importing, setImporting] = useState(false);
  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix:
      history.historyType === "receipt"
        ? "stock_receipts_export"
        : "stock_shipments_export",
    onError: (msg) => setMessageState({ error: msg }),
  });
  const { download: downloadDeliveryScheduleCsv } = useCsvDownload({
    fileNamePrefix: "delivery_schedule",
    onError: (msg) => setMessageState({ error: msg }),
  });

  // Item6 Phase6-4: このCSVインポートは自社倉庫(自社出庫承認)・外部倉庫実績(実績反映承認)の
  // 両方の行を1ファイルに含められるため、どちらかの承認フラグが有効なら非活性化する
  // (Item5以来の「承認機能有効時はCSVインポート非活性化」という既存方針を、2フラグ体制でも
  // 保守的に維持する)
  const wfEnabled =
    (history.historyType === "receipt"
      ? isReceivingWfEnabled || isReceivingResultWfEnabled
      : isShippingWfEnabled || isShippingResultWfEnabled) || false;

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
      {lockedType ? (
        <div className="text-sm px-4 py-2 rounded font-bold border bg-indigo-600 text-white border-indigo-600 inline-block">
          {LOCKED_TYPE_LABELS[lockedType]}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => history.setHistoryType("receipt")}
            className={`text-sm px-4 py-2 rounded font-bold cursor-pointer border ${
              history.historyType === "receipt"
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-700 border-slate-300"
            }`}
          >
            📥 入庫履歴
          </button>
          <button
            type="button"
            onClick={() => history.setHistoryType("shipment")}
            className={`text-sm px-4 py-2 rounded font-bold cursor-pointer border ${
              history.historyType === "shipment"
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-700 border-slate-300"
            }`}
          >
            📤 出庫履歴
          </button>
        </div>
      )}

      <MessageBanner
        message={message.message}
        error={message.error || history.detailError}
      />

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
            <label className="text-sm text-slate-600 block mb-1">倉庫</label>
            <select
              value={history.warehouseId}
              onChange={(e) => history.setWarehouseId(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">🌐 すべて</option>
              {history.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
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
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              {history.historyType === "receipt" ? "仕入先" : "得意先"}
            </label>
            <select
              value={history.partnerId}
              onChange={(e) => history.setPartnerId(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">🌐 すべて</option>
              {history.partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
            disabled={importing || wfEnabled}
            title={
              wfEnabled
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
            disabled={importing || wfEnabled}
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
          {
            key:
              history.historyType === "receipt"
                ? "receivedDate"
                : "shippedDate",
            label: history.historyType === "receipt" ? "入庫日" : "出庫日",
            sortable: true,
          },
          { key: "status", label: "ステータス", sortable: true },
          { key: "memo", label: "備考", sortable: true },
          { key: "createdBy", label: "作成者", sortable: true },
          { key: "actions", label: "" },
        ]}
        data={history.headers}
        loading={history.loading}
        emptyMessage="該当するデータはありません"
        sortBy={history.sortBy}
        sortDirection={history.sortDirection}
        sortKeys={history.sortKeys}
        onSortChange={history.setSort}
        renderRow={(h) => {
          const date =
            history.historyType === "receipt"
              ? (h as ReceiptHeaderRecord).receivedDate
              : (h as ShipmentHeaderRecord).shippedDate;
          const expanded = history.expandedId === h.id;
          const transferWarehouseId = transferWarehouseIdOf(h);
          const detail = history.detailCache[h.id];
          return (
            <Fragment key={h.id}>
              <tr
                className="hover:bg-slate-50 cursor-pointer text-sm"
                onClick={() => void history.toggleExpand(h.id)}
              >
                <td className="px-4 py-2 font-mono font-semibold">
                  {h.id}
                  {history.historyType === "shipment" &&
                    (h as ShipmentHeaderRecord).salesOrderId && (
                      <a
                        href={`/sales/orders?editId=${encodeURIComponent(
                          (h as ShipmentHeaderRecord).salesOrderId as string,
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-2 text-indigo-600 hover:text-indigo-800 hover:underline"
                      >
                        🔗 {(h as ShipmentHeaderRecord).salesOrderId}
                      </a>
                    )}
                  {/* 新規要望(2026-09-23): 倉庫間移動の伝票であることを一覧で判別できるようにする */}
                  {transferWarehouseId && (
                    <span className="ml-2 inline-block text-xs font-bold font-sans text-teal-800 bg-teal-50 border border-teal-300 rounded px-1.5 py-0.5">
                      🔁 倉庫間移動{" "}
                      {history.historyType === "receipt" ? "移動元" : "移動先"}:{" "}
                      {warehouseLabel(transferWarehouseId)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {new Date(date).toLocaleDateString("ja-JP")}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge {...getApprovalResultStatus(h.status)} />
                </td>
                <td className="px-4 py-2 text-slate-600">{h.memo || "-"}</td>
                <td className="px-4 py-2 text-slate-600">{h.createdBy}</td>
                <td className="px-4 py-2 text-right text-indigo-600 font-bold">
                  {expanded ? "▲ 閉じる" : "▼ 明細"}
                </td>
              </tr>
              {expanded && (
                <tr className="bg-slate-50">
                  <td colSpan={6} className="p-3">
                    {history.detailLoading && !detail && (
                      <p className="text-sm text-slate-600">読み込み中...</p>
                    )}
                    {detail && (
                      <div className="mb-2">
                        {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
                        <DocumentCompletionControl
                          stageKey={
                            history.historyType === "receipt"
                              ? "item_receipt"
                              : "item_shipment"
                          }
                          documentId={h.id}
                        />
                      </div>
                    )}
                    {detail && (
                      <table className="w-full text-sm text-slate-800">
                        <thead>
                          <tr className="text-slate-600 text-left">
                            <th className="pr-3 font-bold">品目</th>
                            <th className="pr-3 font-bold">ロケーション</th>
                            <th className="pr-3 font-bold">ロット</th>
                            <th className="pr-3 font-bold">
                              {history.historyType === "receipt"
                                ? "検品"
                                : "品質区分"}
                            </th>
                            <th className="pr-3 font-bold text-right">数量</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map((item) => (
                            <tr
                              key={item.id}
                              className="border-t border-slate-200"
                            >
                              <td className="pr-3 py-1 font-semibold">
                                {item.itemId}
                              </td>
                              <td className="pr-3 py-1">{item.locationId}</td>
                              <td className="pr-3 py-1">{item.lotNumber}</td>
                              <td className="pr-3 py-1">
                                {history.historyType === "receipt"
                                  ? INSPECTION_LABELS[
                                      (item as ReceiptItemRecord)
                                        .inspectionStatus
                                    ] ||
                                    (item as ReceiptItemRecord).inspectionStatus
                                  : QUALITY_LABELS[
                                      (item as ShipmentItemRecord).qualityStatus
                                    ] ||
                                    (item as ShipmentItemRecord).qualityStatus}
                              </td>
                              <td className="pr-3 py-1 text-right font-bold">
                                {history.historyType === "receipt"
                                  ? (item as ReceiptItemRecord).receivedQuantity
                                  : (item as ShipmentItemRecord)
                                      .shippedQuantity}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {detail &&
                      history.historyType === "shipment" &&
                      h.status === "APPROVED" &&
                      (h as ShipmentHeaderRecord).partnerId && (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(
                                `/api/stock-shipments/${h.id}/delivery-note`,
                                "_blank",
                              );
                            }}
                            className="text-sm bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded font-bold cursor-pointer"
                          >
                            📄 納品書PDF
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void downloadDeliveryScheduleCsv(
                                `/api/stock-shipments/${h.id}/delivery-schedule-csv`,
                              );
                            }}
                            className="text-sm bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded font-bold cursor-pointer"
                          >
                            📅 納品予定データCSV
                          </button>
                        </div>
                      )}
                    {detail && h.status === "REMANDED" && onEdit && (
                      <div className="mt-3">
                        <Button
                          variant="success"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(
                              history.historyType,
                              h.id,
                              detail.items,
                              history.historyType === "shipment"
                                ? (h as ShipmentHeaderRecord).partnerId
                                : null,
                              transferWarehouseId,
                            );
                          }}
                        >
                          ✏️ 修正して再申請
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        }}
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
