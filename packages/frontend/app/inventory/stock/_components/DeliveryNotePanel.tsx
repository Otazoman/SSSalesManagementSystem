"use client";

import { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { Pagination } from "../../../_shared/ui/Pagination";
import { DataTable, DataTableColumn } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getApprovalResultStatus } from "../../../_shared/status/approval-result-status";
import { useInventoryHistory } from "../_hooks/useInventoryHistory";
import { ShipmentHeaderRecord } from "../_types";
import {
  DeliveryNoteMailModal,
  DeliveryNoteContactOption,
} from "./DeliveryNoteMailModal";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

const STATUS_OPTIONS = [
  { value: "", label: "🌐 すべて" },
  { value: "UNAPPROVED", label: "🟡 承認申請中" },
  { value: "APPROVED", label: "🟢 承認済み" },
  { value: "REMANDED", label: "🔴 差戻し" },
  { value: "CANCELED", label: "🔵 取下げ" },
];

const inputClass =
  "w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900";

const COLUMNS: DataTableColumn[] = [
  { key: "select", label: "", align: "center" },
  { key: "id", label: "出庫伝票番号", sortable: true },
  { key: "shippedDate", label: "出荷日", sortable: true },
  { key: "partnerId", label: "得意先", sortable: true },
  { key: "status", label: "ステータス", sortable: true },
  { key: "actions", label: "帳票・メール", align: "right" },
];

/**
 * 画面構成再編: 出庫確定時に自動生成される納品書PDF・納品予定データCSVを一覧から
 * 参照・ダウンロードするための専用タブ。既存のInventoryHistoryPanel内の同等ボタンは
 * 変更せず残したまま、こちらは別の入口として追加する(既存ページへの影響を避けるため)。
 * 明細の展開・キャッシュは不要なため、InventoryHistoryPanelより軽量な実装にしている。
 */
export function DeliveryNotePanel() {
  const confirm = useConfirm();
  const { paginationEnabled } = usePaginationSetting();
  const history = useInventoryHistory(paginationEnabled, true, "shipment");
  const [csvError, setCsvError] = useState("");
  const { download: downloadDeliveryScheduleCsv, downloading } = useCsvDownload(
    {
      fileNamePrefix: "delivery_schedule",
      onError: setCsvError,
    },
  );

  // 納品書メール送信(方式A): 見積・受注・発注と同じ「選択して送信」。個別送信はモーダルで
  // 宛先を選択、一括送信はチェックボックスで選んだ行をまとめて配信する
  const [message, setMessage] = useState("");
  const [mailError, setMailError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isMailSending, setIsMailSending] = useState(false);
  const [mailModalTarget, setMailModalTarget] =
    useState<ShipmentHeaderRecord | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [partnerContacts, setPartnerContacts] = useState<
    DeliveryNoteContactOption[]
  >([]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleOpenMailModal = async (header: ShipmentHeaderRecord) => {
    setMailError("");
    setRecipientEmail("");
    setSelectedContactId("");
    setPartnerContacts([]);
    setMailModalTarget(header);
    if (!header.partnerId) return;
    try {
      const data = await apiFetch<
        DeliveryNoteContactOption[] | { data: DeliveryNoteContactOption[] }
      >(`/api/partner-contacts?customerId=${header.partnerId}`);
      setPartnerContacts(Array.isArray(data) ? data : data.data || []);
    } catch (err) {
      console.error("取引先担当者マスタの取得に失敗しました", err);
    }
  };

  // BUG-030: 納品書PDFの作成(作り直し)。承認時の自動作成に失敗した場合や、内容を直した後に使う
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const handleGeneratePdf = async (header: ShipmentHeaderRecord) => {
    setMailError("");
    setMessage("");
    setGeneratingId(header.id);
    try {
      const result = await apiFetch<{ message?: string }>(
        `/api/stock-shipments/${header.id}/generate-pdf`,
        {
          method: "POST",
          defaultErrorMessage: "納品書PDFの作成に失敗しました",
        },
      );
      setMessage(result.message || "納品書PDFを作成しました");
      await history.refetch();
    } catch (err) {
      setMailError(
        err instanceof Error ? err.message : "納品書PDFの作成に失敗しました",
      );
    } finally {
      setGeneratingId(null);
    }
  };

  const handleContactSelect = (contactId: string) => {
    setSelectedContactId(contactId);
    const contact = partnerContacts.find((c) => c.id === contactId);
    if (contact?.email) setRecipientEmail(contact.email);
  };

  const handleSingleSend = async () => {
    if (!mailModalTarget) return;
    if (!recipientEmail || !recipientEmail.includes("@")) {
      setMailError("有効な送信先メールアドレスを入力してください");
      return;
    }
    if (
      !(await confirm(
        `納品書 [ ${mailModalTarget.id} ] を以下の宛先へ送信しますか？\n送信先: ${recipientEmail}`,
      ))
    )
      return;

    setIsMailSending(true);
    setMailError("");
    try {
      const result = await apiFetch<{ message?: string }>(
        `/api/stock-shipments/${mailModalTarget.id}/send-email`,
        {
          method: "POST",
          json: { recipientEmail },
          defaultErrorMessage: "メール送信に失敗しました",
        },
      );
      setMessage(result.message || "メールの送信を予約しました");
      setMailModalTarget(null);
      // 送信時に納品書PDFを作った場合に、一覧の表示(PDF の有無)を更新する
      await history.refetch();
    } catch (err) {
      setMailError(
        err instanceof Error ? err.message : "メール送信に失敗しました",
      );
    } finally {
      setIsMailSending(false);
    }
  };

  const handleBulkSend = async () => {
    if (selectedIds.length === 0) return;
    if (
      !(await confirm(
        `選択した ${selectedIds.length} 件の納品書をメール一括送信しますか？`,
      ))
    )
      return;

    setIsMailSending(true);
    setMailError("");
    try {
      const result = await apiFetch<{ message?: string }>(
        "/api/stock-shipments/bulk-send-email",
        {
          method: "POST",
          json: { shipmentHeaderIds: selectedIds },
          defaultErrorMessage: "メール一括送信に失敗しました",
        },
      );
      setMessage(result.message || "メールの一括送信を予約しました");
      setSelectedIds([]);
    } catch (err) {
      setMailError(
        err instanceof Error ? err.message : "メール一括送信に失敗しました",
      );
    } finally {
      setIsMailSending(false);
    }
  };

  // lockedType="shipment"相当の使い方のため、headers は常に ShipmentHeaderRecord[] で渡ってくる
  const shipmentHeaders = history.headers as unknown as ShipmentHeaderRecord[];

  return (
    <div className="space-y-4">
      <MessageBanner
        message={message}
        error={mailError || csvError || history.detailError}
      />

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              出荷日(From)
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
              出荷日(To)
            </label>
            <input
              type="date"
              value={history.dateTo}
              onChange={(e) => history.setDateTo(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">得意先</label>
            <select
              value={history.partnerId}
              onChange={(e) => history.setPartnerId(e.target.value)}
              className={inputClass}
            >
              <option value="">🌐 すべて</option>
              {history.partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              ステータス
            </label>
            <select
              value={history.status}
              onChange={(e) => history.setStatus(e.target.value)}
              className={inputClass}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={history.clearFilters}
              className="text-sm border border-slate-300 px-3 py-2 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm cursor-pointer w-full"
            >
              条件クリア
            </button>
          </div>
        </div>
        <div className="flex justify-end items-center gap-3">
          <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
            該当件数:{" "}
            <span className="font-black text-indigo-600">{history.total}</span>{" "}
            件
          </span>
          <Button
            size="sm"
            onClick={() => void handleBulkSend()}
            disabled={selectedIds.length === 0 || isMailSending}
          >
            {isMailSending
              ? "送信中..."
              : `選択したデータをメール一括送信 (${selectedIds.length}件) 📧`}
          </Button>
        </div>
      </div>

      <DataTable
        columns={COLUMNS}
        data={shipmentHeaders}
        loading={history.loading}
        emptyMessage="該当するデータはありません"
        sortBy={history.sortBy}
        sortDirection={history.sortDirection}
        sortKeys={history.sortKeys}
        onSortChange={history.setSort}
        renderRow={(h) => {
          const canIssue = h.status === "APPROVED" && !!h.partnerId;
          // BUG-030: PDF が無くても、送信の時に作るため送信できる
          const canSendMail = canIssue;
          const partner = history.partners.find((p) => p.id === h.partnerId);
          return (
            <tr
              key={h.id}
              className="border-b border-slate-100 hover:bg-slate-50"
            >
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  disabled={!canSendMail}
                  checked={selectedIds.includes(h.id)}
                  onChange={() => toggleSelect(h.id)}
                  className="disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                />
              </td>
              <td className="px-4 py-3 font-mono text-slate-700">{h.id}</td>
              <td className="px-4 py-3">{h.shippedDate?.slice(0, 10)}</td>
              <td className="px-4 py-3">{partner?.name || "-"}</td>
              <td className="px-4 py-3">
                <StatusBadge {...getApprovalResultStatus(h.status)} />
              </td>
              <td className="px-4 py-3 text-right">
                {!canIssue ? (
                  <span className="text-slate-500">-</span>
                ) : (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={generatingId === h.id}
                      onClick={() => void handleGeneratePdf(h)}
                    >
                      {generatingId === h.id
                        ? "作成中..."
                        : h.deliveryNoteR2Path
                          ? "🔄 PDFを作り直す"
                          : "📄 納品書PDFを作成"}
                    </Button>
                    {h.deliveryNoteR2Path && (
                      <button
                        type="button"
                        onClick={() =>
                          window.open(
                            `/api/stock-shipments/${h.id}/delivery-note`,
                            "_blank",
                          )
                        }
                        className="text-xs bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded font-bold cursor-pointer"
                      >
                        📄 納品書PDF
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={downloading}
                      onClick={() =>
                        void downloadDeliveryScheduleCsv(
                          `/api/stock-shipments/${h.id}/delivery-schedule-csv`,
                        )
                      }
                      className="text-xs bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded font-bold cursor-pointer disabled:opacity-50"
                    >
                      📅 CSV
                    </button>
                    <Button
                      size="sm"
                      onClick={() => void handleOpenMailModal(h)}
                    >
                      ✉️ 送信
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          );
        }}
      />

      {mailModalTarget && (
        <DeliveryNoteMailModal
          shipmentHeaderId={mailModalTarget.id}
          recipientEmail={recipientEmail}
          setRecipientEmail={setRecipientEmail}
          partnerContacts={partnerContacts}
          selectedContactId={selectedContactId}
          onContactSelect={handleContactSelect}
          onClose={() => setMailModalTarget(null)}
          onSend={() => void handleSingleSend()}
          isMailSending={isMailSending}
        />
      )}

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
