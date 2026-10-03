"use client";

import { Fragment, useState } from "react";
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
import { getInstructionStatus } from "../../../_shared/status/approval-result-status";
import { ManualProductPicker } from "./ManualProductPicker";
import {
  useShipmentInstructionForm,
  ShipmentInstructionEditTarget,
  ShipmentInstructionCreatePrefill,
} from "../_hooks/useShipmentInstructionForm";
import { useShipmentInstructionHistory } from "../_hooks/useShipmentInstructionHistory";
import {
  ShipmentInstructionHeaderRecord,
  ShipmentInstructionItemRecord,
} from "../_types";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

const STATUS_OPTIONS = [
  { value: "", label: "🌐 すべて" },
  { value: "UNAPPROVED", label: "🟡 承認申請中" },
  { value: "APPROVED", label: "🟢 発行済み" },
  { value: "PARTIALLY_FULFILLED", label: "🟠 一部実績反映" },
  { value: "FULFILLED", label: "✅ 実績反映済み" },
  { value: "REMANDED", label: "🔴 差戻し" },
  { value: "CANCELED", label: "🔵 取下げ" },
];

const inputClass =
  "w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900";

export interface ShipmentInstructionPanelProps {
  initialEditTarget?: ShipmentInstructionEditTarget | null;
  onEditConsumed?: () => void;
  // Item7残課題6 Phase B: 「受注から選ぶ」で選択した受注ID(任意)
  fromSalesOrderId?: string | null;
  // Item7残課題6 Phase A: 受注画面の「出荷指示を作成する」からの自動prefill(任意)
  createPrefill?: ShipmentInstructionCreatePrefill | null;
}

export function ShipmentInstructionPanel({
  initialEditTarget,
  onEditConsumed,
  fromSalesOrderId,
  createPrefill,
}: ShipmentInstructionPanelProps) {
  const confirm = useConfirm();
  const { isShippingInstructionWfEnabled, departments } = usePagePermissions();
  const { paginationEnabled } = usePaginationSetting();
  const [message, setMessageState] = useState<{
    message?: string;
    error?: string;
  }>({});
  const [editTarget, setEditTarget] =
    useState<ShipmentInstructionEditTarget | null>(initialEditTarget || null);

  const history = useShipmentInstructionHistory(paginationEnabled, true);
  const form = useShipmentInstructionForm(
    (msg) => {
      setMessageState({ message: msg });
      setEditTarget(null);
      onEditConsumed?.();
      void history.refetch();
    },
    editTarget,
    createPrefill,
    fromSalesOrderId,
    departments,
  );

  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "shipment_instructions_export",
    onError: (msg) => setMessageState({ error: msg }),
  });
  const { download: downloadInstructionCsv } = useCsvDownload({
    fileNamePrefix: "shipment_instruction",
    onError: (msg) => setMessageState({ error: msg }),
  });

  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);

  const eligibleForPdf = (status: string) =>
    status === "APPROVED" ||
    status === "PARTIALLY_FULFILLED" ||
    status === "FULFILLED";

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkSend = async () => {
    if (selectedIds.size === 0) return;
    setMessageState({});
    setBulkSending(true);
    try {
      const result = await apiFetch<{ message: string }>(
        "/api/shipment-instructions/bulk-generate-pdf",
        {
          method: "POST",
          json: { ids: Array.from(selectedIds) },
          defaultErrorMessage: "一括PDF発行・送信に失敗しました",
        },
      );
      setMessageState({ message: result.message });
      setSelectedIds(new Set());
      void history.refetch();
    } catch (err: unknown) {
      setMessageState({
        error:
          err instanceof Error
            ? err.message
            : "一括PDF発行・送信に失敗しました",
      });
    } finally {
      setBulkSending(false);
    }
  };

  const handleGeneratePdf = async (id: string) => {
    setMessageState({});
    setGeneratingPdfId(id);
    try {
      const result = await apiFetch<{ message: string }>(
        `/api/shipment-instructions/${id}/generate-pdf`,
        {
          method: "POST",
          defaultErrorMessage: "出荷指示書PDFの生成に失敗しました",
        },
      );
      setMessageState({ message: result.message });
      void history.refetch();
    } catch (err: unknown) {
      setMessageState({
        error:
          err instanceof Error
            ? err.message
            : "出荷指示書PDFの生成に失敗しました",
      });
    } finally {
      setGeneratingPdfId(null);
    }
  };

  // 消込状況(品目×ロット単位の指示数量/消込済み数量/残数量)の行展開表示
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<
    ShipmentInstructionItemRecord[]
  >([]);
  const [expandLoading, setExpandLoading] = useState(false);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setExpandLoading(true);
    try {
      const detail = await apiFetch<{ items: ShipmentInstructionItemRecord[] }>(
        `/api/shipment-instructions/${id}`,
      );
      setExpandedItems(detail.items);
    } catch (err: unknown) {
      setMessageState({
        error:
          err instanceof Error ? err.message : "消込状況の取得に失敗しました",
      });
      setExpandedId(null);
    } finally {
      setExpandLoading(false);
    }
  };

  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const handleCancel = async (id: string) => {
    if (!(await confirm(`出荷指示[${id}]を取消しますか？(取消後は元に戻せません)`)))
      return;
    setMessageState({});
    setCancelingId(id);
    try {
      const result = await apiFetch<{ message: string }>(
        `/api/shipment-instructions/${id}/cancel`,
        {
          method: "POST",
          defaultErrorMessage: "出荷指示の取消に失敗しました",
        },
      );
      setMessageState({ message: result.message });
      void history.refetch();
    } catch (err: unknown) {
      setMessageState({
        error:
          err instanceof Error ? err.message : "出荷指示の取消に失敗しました",
      });
    } finally {
      setCancelingId(null);
    }
  };

  const handleEdit = async (id: string) => {
    setMessageState({});
    try {
      const detail = await apiFetch<{
        header: ShipmentInstructionHeaderRecord;
        items: ShipmentInstructionItemRecord[];
      }>(`/api/shipment-instructions/${id}`);
      setEditTarget({
        headerId: id,
        partnerId: detail.header.partnerId,
        warehouseId: detail.header.warehouseId,
        instructedShipDate: detail.header.instructedShipDate,
        memo: detail.header.memo,
        items: detail.items,
      });
    } catch (err: unknown) {
      setMessageState({
        error: err instanceof Error ? err.message : "詳細の取得に失敗しました",
      });
    }
  };

  return (
    <div className="space-y-6">
      {(message.message || message.error) && (
        <MessageBanner message={message.message} error={message.error} />
      )}
      {form.error && <MessageBanner error={form.error} />}

      <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-4">
        {editTarget && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5">
            <p className="text-sm font-bold text-amber-800">
              ✏️ 出荷指示[{editTarget.headerId}
              ]を修正して再申請します(差戻し内容を書き換えます)
            </p>
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              className="text-xs font-bold text-amber-700 hover:text-amber-900 cursor-pointer underline"
            >
              編集をキャンセル
            </button>
          </div>
        )}

        <h3 className="text-sm font-bold text-slate-800">
          🚚 出荷指示の新規登録
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {!editTarget && (
            <div>
              <label className="text-sm text-slate-600 block mb-1">
                管理番号(任意・未入力なら自動採番)
              </label>
              <input
                type="text"
                value={form.customId}
                onChange={(e) => form.setCustomId(e.target.value)}
                placeholder={`例: SI-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}-1234`}
                className={inputClass}
              />
            </div>
          )}
          <div>
            <label className="text-sm text-slate-600 block mb-1">得意先</label>
            <select
              value={form.partnerId}
              onChange={(e) => form.setPartnerId(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">選択してください</option>
              {form.partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} ({p.name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">倉庫</label>
            <select
              value={form.warehouseId}
              onChange={(e) => form.setWarehouseId(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">選択してください</option>
              {form.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.id} ({w.name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              出荷予定日
            </label>
            <input
              type="date"
              value={form.instructedShipDate}
              onChange={(e) => form.setInstructedShipDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-600 block mb-1">
            備考(指示書全体・任意)
          </label>
          <textarea
            value={form.memo}
            onChange={(e) => form.setMemo(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </div>

        {form.orderSuggestions.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-bold text-indigo-800">
              🧾 受注の未出荷明細(クリックすると品目・数量を入力欄へ反映します)
            </p>
            <div className="flex flex-wrap gap-2">
              {form.orderSuggestions.map((s) => (
                <button
                  key={s.salesOrderItemId}
                  type="button"
                  onClick={() => form.applyOrderSuggestion(s)}
                  className="text-xs border border-indigo-300 bg-white hover:bg-indigo-100 text-indigo-700 px-2.5 py-1.5 rounded font-bold cursor-pointer"
                >
                  {s.itemId} ({s.itemName}) / 残数量 {s.remainingQuantity}
                </button>
              ))}
            </div>
          </div>
        )}

        <ManualProductPicker
          products={form.products}
          onSelect={(p) => form.setSelectedProduct(p)}
        />

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div className="text-sm">
            <p className="text-slate-600">選択中品目</p>
            <p className="font-bold text-slate-900 text-base">
              {form.selectedProduct
                ? `${form.selectedProduct.id} (${form.selectedProduct.name})`
                : "未選択"}
            </p>
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              ロット番号(任意)
            </label>
            <input
              type="text"
              value={form.lotNumber}
              onChange={(e) => form.setLotNumber(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">数量</label>
            <input
              type="number"
              value={form.quantity}
              onChange={(e) => form.setQuantity(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900 font-bold"
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              備考(明細・任意)
            </label>
            <input
              type="text"
              value={form.lineMemo}
              onChange={(e) => form.setLineMemo(e.target.value)}
              className={inputClass}
            />
          </div>
          <Button className="h-fit" onClick={form.addLine}>
            ＋ 明細に追加
          </Button>
        </div>

        {form.lines.length > 0 && (
          <DataTable
            columns={[
              { key: "item", label: "品目" },
              { key: "lot", label: "ロット" },
              { key: "quantity", label: "数量", align: "right" },
              { key: "memo", label: "備考" },
              { key: "actions", label: "" },
            ]}
            data={form.lines}
            renderRow={(l) => (
              <tr key={l.key} className="hover:bg-slate-50 text-sm">
                <td className="px-4 py-2 font-semibold">
                  {l.itemId} ({l.itemName})
                </td>
                <td className="px-4 py-2">{l.lotNumber}</td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    value={l.instructedQuantity}
                    onChange={(e) =>
                      form.updateLineQuantity(l.key, Number(e.target.value))
                    }
                    className="w-24 text-right text-sm font-bold border border-slate-300 rounded px-2 py-1 bg-slate-50 text-slate-900"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={l.memo}
                    onChange={(e) => form.updateLineMemo(l.key, e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded px-2 py-1 bg-slate-50 text-slate-900"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => form.removeLine(l.key)}
                    className="text-red-600 hover:text-red-800 cursor-pointer text-sm font-bold"
                  >
                    削除
                  </button>
                </td>
              </tr>
            )}
          />
        )}

        {isShippingInstructionWfEnabled && (
          <ApplicantDepartmentSelect
            departments={departments}
            value={form.applicantDepartmentSurrogateId}
            onChange={form.setApplicantDepartmentSurrogateId}
          />
        )}

        <button
          type="button"
          onClick={() => void form.submit()}
          disabled={form.submitting || form.lines.length === 0}
          className={`w-full text-base text-white px-4 py-3 rounded font-bold disabled:bg-slate-300 disabled:cursor-not-allowed ${
            form.submitting || form.lines.length === 0
              ? ""
              : isShippingInstructionWfEnabled
                ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 cursor-pointer"
                : "bg-sky-700 hover:bg-sky-800 cursor-pointer"
          }`}
        >
          {form.submitting
            ? editTarget
              ? "⏳ 再申請を送信中..."
              : isShippingInstructionWfEnabled
                ? "⏳ 承認申請を送信中..."
                : "処理中..."
            : editTarget
              ? `✏️ 修正して再申請する(${form.lines.length}件)`
              : isShippingInstructionWfEnabled
                ? `✨ 出荷指示の承認を申請する(${form.lines.length}件)`
                : `出荷指示を発行(${form.lines.length}件)`}
        </button>
      </div>

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            onClick={() => void downloadCsv(history.csvDownloadUrl)}
            className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
          >
            📥 指示データCSVダウンロード
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

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
          <p className="text-sm font-bold text-indigo-800">
            {selectedIds.size}件を選択中
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer underline"
            >
              選択解除
            </button>
            <button
              type="button"
              onClick={() => void handleBulkSend()}
              disabled={bulkSending}
              className="text-sm bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white px-4 py-2 rounded font-bold cursor-pointer disabled:cursor-not-allowed"
            >
              {bulkSending
                ? "⏳ 一括発行・送信中..."
                : `📄 選択した指示書を一括発行・送信(${selectedIds.size}件)`}
            </button>
          </div>
        </div>
      )}

      <DataTable
        columns={[
          { key: "select", label: "" },
          { key: "id", label: "ID", sortable: true },
          { key: "partnerId", label: "得意先", sortable: true },
          { key: "warehouseId", label: "倉庫", sortable: true },
          { key: "instructedShipDate", label: "出荷予定日", sortable: true },
          { key: "status", label: "ステータス", sortable: true },
          { key: "createdBy", label: "作成者", sortable: true },
          { key: "actions", label: "" },
        ]}
        data={history.instructions}
        loading={history.loading}
        emptyMessage="該当するデータはありません"
        sortBy={history.sortBy}
        sortDirection={history.sortDirection}
        sortKeys={history.sortKeys}
        onSortChange={history.setSort}
        renderRow={(i) => (
          <Fragment key={i.id}>
            <tr className="hover:bg-slate-50 text-sm">
              <td className="px-4 py-2">
                {eligibleForPdf(i.status) && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(i.id)}
                    onChange={() => toggleSelected(i.id)}
                    className="w-4 h-4 cursor-pointer"
                  />
                )}
              </td>
              <td className="px-4 py-2 font-mono font-semibold">{i.id}</td>
              <td className="px-4 py-2">{i.partnerId}</td>
              <td className="px-4 py-2">{i.warehouseId}</td>
              <td className="px-4 py-2">
                {i.instructedShipDate?.slice(0, 10)}
              </td>
              <td className="px-4 py-2">
                <StatusBadge {...getInstructionStatus(i.status)} />
              </td>
              <td className="px-4 py-2 text-slate-600">{i.createdBy}</td>
              <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                {eligibleForPdf(i.status) && (
                  <Button size="sm" onClick={() => void toggleExpand(i.id)}>
                    {expandedId === i.id ? "▲ 消込状況を閉じる" : "📋 消込状況"}
                  </Button>
                )}
                {i.status === "REMANDED" && (
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => void handleEdit(i.id)}
                  >
                    ✏️ 修正して再申請
                  </Button>
                )}
                {i.instructionDocumentR2Path && (
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `/api/shipment-instructions/${i.id}/document`,
                        "_blank",
                      )
                    }
                  >
                    📄 PDFを表示
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() =>
                    void downloadInstructionCsv(
                      `/api/shipment-instructions/${i.id}/csv`,
                    )
                  }
                >
                  📊 指示データCSV
                </Button>
                {(i.status === "APPROVED" ||
                  i.status === "PARTIALLY_FULFILLED" ||
                  i.status === "FULFILLED") && (
                  <button
                    type="button"
                    onClick={() => void handleGeneratePdf(i.id)}
                    disabled={generatingPdfId === i.id}
                    className="text-sm bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white px-3 py-1.5 rounded font-bold cursor-pointer disabled:cursor-not-allowed"
                  >
                    {generatingPdfId === i.id
                      ? "⏳ 生成中..."
                      : i.instructionDocumentR2Path
                        ? "🔄 PDF再発行"
                        : "📄 指示書PDF発行"}
                  </button>
                )}
                {(i.status === "APPROVED" ||
                  i.status === "PARTIALLY_FULFILLED" ||
                  i.status === "REMANDED") && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void handleCancel(i.id)}
                    disabled={cancelingId === i.id}
                  >
                    {cancelingId === i.id ? "⏳ 取消中..." : "🚫 取消"}
                  </Button>
                )}
              </td>
            </tr>
            {expandedId === i.id && (
              <tr className="bg-slate-50">
                <td colSpan={8} className="px-4 py-3 space-y-2">
                  {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
                  <DocumentCompletionControl
                    stageKey="shipment_instruction"
                    documentId={i.id}
                  />
                  {expandLoading ? (
                    <p className="text-xs text-slate-500">読み込み中...</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="text-left py-1 font-bold">品目</th>
                          <th className="text-left py-1 font-bold">ロット</th>
                          <th className="text-right py-1 font-bold">
                            指示数量
                          </th>
                          <th className="text-right py-1 font-bold">
                            消込済み
                          </th>
                          <th className="text-right py-1 font-bold">残数量</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expandedItems.map((item) => (
                          <tr
                            key={item.id}
                            className={
                              (item.remainingQuantity ??
                                item.instructedQuantity) > 0
                                ? "text-amber-700 font-bold"
                                : "text-slate-600"
                            }
                          >
                            <td className="py-1">{item.itemId}</td>
                            <td className="py-1">{item.lotNumber}</td>
                            <td className="py-1 text-right">
                              {item.instructedQuantity}
                            </td>
                            <td className="py-1 text-right">
                              {item.fulfilledQuantity ?? 0}
                            </td>
                            <td className="py-1 text-right">
                              {item.remainingQuantity ??
                                item.instructedQuantity}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </td>
              </tr>
            )}
          </Fragment>
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
