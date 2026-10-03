"use client";

import { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { Pagination } from "../../../_shared/ui/Pagination";
import { DataTable, DataTableColumn } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getApprovalResultStatus } from "../../../_shared/status/approval-result-status";
import { useInventoryHistory } from "../_hooks/useInventoryHistory";
import { ReceiptHeaderRecord } from "../_types";
import {
  AcceptanceInspectionMailModal,
  AcceptanceInspectionContactOption,
} from "./AcceptanceInspectionMailModal";
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
  { key: "id", label: "入庫伝票番号", sortable: true },
  { key: "receivedDate", label: "入荷日", sortable: true },
  { key: "partnerId", label: "仕入先", sortable: true },
  { key: "status", label: "ステータス", sortable: true },
  { key: "actions", label: "検収書・メール", align: "right" },
];

/**
 * 検収書発行(Item9、発注書と同じ方式=オンデマンド発行+複数バージョン管理の添付テーブル):
 * 承認済みの入庫からPDFを都度発行し、選択して送信(個別/一括、方式A)できるようにする専用タブ。
 * 納品書発行タブ(DeliveryNotePanel.tsx)と同じ骨格だが、単一R2パス列ではなく複数バージョン
 * 管理のため「発行」操作と「最新版をダウンロード」操作を分離している。
 */
export function AcceptanceInspectionPanel() {
  const confirm = useConfirm();
  const { paginationEnabled } = usePaginationSetting();
  const history = useInventoryHistory(paginationEnabled, true, "receipt");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isMailSending, setIsMailSending] = useState(false);
  const [mailModalTarget, setMailModalTarget] =
    useState<ReceiptHeaderRecord | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [partnerContacts, setPartnerContacts] = useState<
    AcceptanceInspectionContactOption[]
  >([]);

  // lockedType="receipt"相当の使い方のため、headers は常に ReceiptHeaderRecord[] で渡ってくる
  const receiptHeaders = history.headers as unknown as ReceiptHeaderRecord[];

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleGeneratePdf = async (h: ReceiptHeaderRecord) => {
    setGeneratingId(h.id);
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{ message?: string }>(
        `/api/stock-receipts/${h.id}/generate-pdf`,
        {
          method: "POST",
          defaultErrorMessage: "検収書PDFの生成に失敗しました",
        },
      );
      setMessage(result.message || "検収書PDFを生成しました");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "検収書PDFの生成に失敗しました",
      );
    } finally {
      setGeneratingId(null);
    }
  };

  const handleDownloadLatest = async (h: ReceiptHeaderRecord) => {
    setDownloadingId(h.id);
    setError("");
    try {
      const detail = await apiFetch<{
        attachments: Array<{
          id: string;
          fileType: string;
          uploadedAt: string;
        }>;
      }>(`/api/stock-receipts/${h.id}`, {
        defaultErrorMessage: "検収書の取得に失敗しました",
      });
      const latest = detail.attachments
        .filter((att) => att.fileType === "PDF")
        .sort(
          (a, b) =>
            new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        )[0];
      if (!latest) {
        setError(
          "この入庫にはまだ検収書PDFが発行されていません。先に「発行」を押してください。",
        );
        return;
      }
      window.open(
        `/api/stock-receipts/download/${h.id}/${latest.id}`,
        "_blank",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "検収書の取得に失敗しました",
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleOpenMailModal = async (header: ReceiptHeaderRecord) => {
    setError("");
    setRecipientEmail("");
    setSelectedContactId("");
    setPartnerContacts([]);
    setMailModalTarget(header);
    if (!header.partnerId) return;
    try {
      const data = await apiFetch<
        | AcceptanceInspectionContactOption[]
        | { data: AcceptanceInspectionContactOption[] }
      >(`/api/partner-contacts?customerId=${header.partnerId}`);
      setPartnerContacts(Array.isArray(data) ? data : data.data || []);
    } catch (err) {
      console.error("取引先担当者マスタの取得に失敗しました", err);
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
      setError("有効な送信先メールアドレスを入力してください");
      return;
    }
    if (
      !(await confirm(
        `検収書 [ ${mailModalTarget.id} ] を以下の宛先へ送信しますか？\n送信先: ${recipientEmail}`,
      ))
    )
      return;

    setIsMailSending(true);
    setError("");
    try {
      const result = await apiFetch<{ message?: string }>(
        `/api/stock-receipts/${mailModalTarget.id}/send-email`,
        {
          method: "POST",
          json: { recipientEmail },
          defaultErrorMessage: "メール送信に失敗しました",
        },
      );
      setMessage(result.message || "メールの送信を予約しました");
      setMailModalTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "メール送信に失敗しました");
    } finally {
      setIsMailSending(false);
    }
  };

  const handleBulkSend = async () => {
    if (selectedIds.length === 0) return;
    if (
      !(await confirm(
        `選択した ${selectedIds.length} 件の検収書をメール一括送信しますか？`,
      ))
    )
      return;

    setIsMailSending(true);
    setError("");
    try {
      const result = await apiFetch<{ message?: string }>(
        "/api/stock-receipts/bulk-send-email",
        {
          method: "POST",
          json: { receiptIds: selectedIds },
          defaultErrorMessage: "メール一括送信に失敗しました",
        },
      );
      setMessage(result.message || "メールの一括送信を予約しました");
      setSelectedIds([]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "メール一括送信に失敗しました",
      );
    } finally {
      setIsMailSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <MessageBanner message={message} error={error || history.detailError} />

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-sm text-slate-600 block mb-1">
              入荷日(From)
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
              入荷日(To)
            </label>
            <input
              type="date"
              value={history.dateTo}
              onChange={(e) => history.setDateTo(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">仕入先</label>
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
        data={receiptHeaders}
        loading={history.loading}
        emptyMessage="該当するデータはありません"
        sortBy={history.sortBy}
        sortDirection={history.sortDirection}
        sortKeys={history.sortKeys}
        onSortChange={history.setSort}
        renderRow={(h) => {
          const canIssue = h.status === "APPROVED";
          const partner = history.partners.find((p) => p.id === h.partnerId);
          return (
            <tr
              key={h.id}
              className="border-b border-slate-100 hover:bg-slate-50"
            >
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  disabled={!canIssue}
                  checked={selectedIds.includes(h.id)}
                  onChange={() => toggleSelect(h.id)}
                  className="disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                />
              </td>
              <td className="px-4 py-3 font-mono text-slate-700">{h.id}</td>
              <td className="px-4 py-3">{h.receivedDate?.slice(0, 10)}</td>
              <td className="px-4 py-3">{partner?.name || "-"}</td>
              <td className="px-4 py-3">
                <StatusBadge {...getApprovalResultStatus(h.status)} />
              </td>
              <td className="px-4 py-3 text-right">
                {!canIssue ? (
                  <span className="text-slate-600">-</span>
                ) : (
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={generatingId === h.id}
                      onClick={() => void handleGeneratePdf(h)}
                      className="text-xs bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded font-bold cursor-pointer disabled:opacity-50"
                    >
                      {generatingId === h.id ? "発行中..." : "📄 検収書発行"}
                    </button>
                    <button
                      type="button"
                      disabled={downloadingId === h.id}
                      onClick={() => void handleDownloadLatest(h)}
                      className="text-xs bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded font-bold cursor-pointer disabled:opacity-50"
                    >
                      📥 最新版
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

      <Pagination
        paginationEnabled={paginationEnabled}
        page={history.page}
        totalPages={history.totalPages}
        total={history.total}
        limit={history.limit}
        onPageChange={history.setPage}
        onLimitChange={history.setLimit}
      />

      {mailModalTarget && (
        <AcceptanceInspectionMailModal
          receiptId={mailModalTarget.id}
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
    </div>
  );
}
