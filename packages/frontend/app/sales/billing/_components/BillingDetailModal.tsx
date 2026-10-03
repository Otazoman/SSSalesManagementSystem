import React, { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { BillingDetail } from "../_types";
import { PartnerContactOption } from "../_hooks/useBillingActions";
import { BillingMailModal } from "./BillingMailModal";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import { METHOD_LABELS } from "../../../_shared/payment-method-labels";
import { todayJst } from "../../../_shared/jst-date";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface BillingDetailModalProps {
  detail: BillingDetail | null;
  onClose: () => void;
  onGeneratePDF: (id: string) => void;
  onRecordPaymentReceipt: (
    billingHeaderId: string,
    payload: {
      receivedDate: string;
      amount: number;
      method: string;
      memo?: string;
    },
  ) => Promise<boolean>;
  // K-4-4: 請求書の再発行(保存済みPDFの再ダウンロード・再送付)
  showMailModal: boolean;
  setShowMailModal: (v: boolean) => void;
  recipientEmail: string;
  setRecipientEmail: (v: string) => void;
  partnerContacts: PartnerContactOption[];
  selectedContactId: string;
  restrictToRegisteredContacts?: boolean;
  onContactSelect: (contactId: string) => void;
  onSendEmail: () => void;
  isMailSending: boolean;
}

// Item8 Phase4: 請求内容の確認・PDF発行・手動消込入力を行う詳細モーダル
export function BillingDetailModal({
  detail,
  onClose,
  onGeneratePDF,
  onRecordPaymentReceipt,
  showMailModal,
  setShowMailModal,
  recipientEmail,
  setRecipientEmail,
  partnerContacts,
  selectedContactId,
  restrictToRegisteredContacts = false,
  onContactSelect,
  onSendEmail,
  isMailSending,
}: BillingDetailModalProps) {
  const [receivedDate, setReceivedDate] = useState(
    todayJst(),
  );
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [memo, setMemo] = useState("");
  // K-4-2: 対象売上明細の展開表示状態
  const [expandedInvoiceIds, setExpandedInvoiceIds] = useState<Set<string>>(
    new Set(),
  );
  const confirm = useConfirm();

  if (!detail) return null;

  const remaining = Math.max(detail.totalAmount - detail.reconciledAmount, 0);
  // BUG-051: 未発行(下書き)の請求には入金を記録できない(請求書を発行するとISSUEDになる)
  const isDraft = detail.status === "DRAFT";

  const toggleExpanded = (itemId: string) => {
    setExpandedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleSubmitReceipt = async () => {
    const amountNumber = Number(amount);
    if (!amountNumber || amountNumber <= 0 || isDraft) return;
    // BUG-051: 未消込額を超える分は、サーバー側で前受金(入金(単体入金))として登録される
    if (
      amountNumber > remaining &&
      !(await confirm(
        `入金額 ¥${amountNumber.toLocaleString()} は未消込額 ¥${remaining.toLocaleString()} を超えています。\n超えた ¥${(amountNumber - remaining).toLocaleString()} は前受金(入金(単体入金))として登録します。よろしいですか？`,
      ))
    ) {
      return;
    }
    const success = await onRecordPaymentReceipt(detail.id, {
      receivedDate,
      amount: amountNumber,
      method,
      memo: memo || undefined,
    });
    if (success) {
      setAmount("");
      setMemo("");
    }
  };

  return (
    <>
      <Modal
        title={
          <>
            📄 請求詳細 [{detail.id}]
            <span className="block text-[11px] font-normal text-slate-600">
              {detail.title || "(件名未設定)"}
            </span>
          </>
        }
        size="2xl"
        onClose={onClose}
        warnOnDiscard
      >
        {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
        <DocumentCompletionControl stageKey="billing" documentId={detail.id} />

        <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-lg p-3.5 border border-slate-200/80 text-xs">
          <div>
            <span className="text-slate-600 font-bold block">請求日</span>
            <span className="font-bold text-slate-800">
              {detail.billingDate?.split("T")[0]}
            </span>
          </div>
          <div>
            <span className="text-slate-600 font-bold block">方式</span>
            <span className="font-bold text-slate-800">
              {detail.mode === "PER_TRANSACTION" ? "都度請求" : "締め請求"}
            </span>
          </div>
          <div>
            <span className="text-slate-600 font-bold block">
              合計金額(税込)
            </span>
            <span className="font-mono font-black text-indigo-600">
              ¥{detail.totalAmount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-600 font-bold block">
              消込済/未消込
            </span>
            <span className="font-mono font-bold text-slate-800">
              ¥{detail.reconciledAmount.toLocaleString()} / ¥
              {remaining.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200">
            対象の売上明細
          </div>
          <div className="divide-y divide-slate-100">
            {detail.items.map((item) => {
              const isExpanded = expandedInvoiceIds.has(item.id);
              // K-4-3: 完全手動入力行(salesInvoiceIdがnull)は展開の必要がない単一明細のため、
              // 品目名バッジを表示し折りたたみトグルは出さない
              if (!item.salesInvoiceId) {
                return (
                  <div
                    key={item.id}
                    className="w-full flex justify-between items-center px-3 py-2 text-xs"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
                        直接入力
                      </span>
                      <span className="font-semibold text-slate-700">
                        {item.itemName || "(品目未設定)"}
                      </span>
                      <span className="text-slate-500">
                        {item.quantity ?? 0} × ¥
                        {(item.unitPrice ?? 0).toLocaleString()}
                      </span>
                    </span>
                    <span className="font-mono font-bold text-slate-800">
                      ¥{item.amount.toLocaleString()}
                    </span>
                  </div>
                );
              }
              return (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.id)}
                    className="w-full flex justify-between items-center px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-slate-600">
                        {isExpanded ? "▼" : "▶"}
                      </span>
                      <span className="font-mono font-bold text-indigo-600">
                        {item.salesInvoiceId}
                      </span>
                    </span>
                    <span className="text-slate-600">
                      {item.salesInvoice?.invoiceDate?.split("T")[0]}
                    </span>
                    <span className="font-mono font-bold text-slate-800">
                      ¥{item.amount.toLocaleString()}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-2 pl-8">
                      {item.invoiceItems.length === 0 ? (
                        <p className="text-[11px] text-slate-600">
                          明細情報がありません。
                        </p>
                      ) : (
                        <table className="w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="text-slate-500 text-left">
                              <th className="pr-3 font-bold pb-1">品目</th>
                              <th className="pr-3 font-bold pb-1 text-right">
                                数量
                              </th>
                              <th className="pr-3 font-bold pb-1 text-right">
                                単価
                              </th>
                              <th className="font-bold pb-1 text-right">
                                金額
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.invoiceItems.map((line) => (
                              <tr
                                key={line.id}
                                className="border-t border-slate-100"
                              >
                                <td className="pr-3 py-1 font-semibold text-slate-700">
                                  {line.itemName || line.itemId || "-"}
                                </td>
                                <td className="pr-3 py-1 text-right text-slate-600">
                                  {line.quantity}
                                  {line.unitCode ? ` ${line.unitCode}` : ""}
                                </td>
                                <td className="pr-3 py-1 text-right text-slate-600 font-mono">
                                  ¥{line.unitPrice.toLocaleString()}
                                </td>
                                <td className="py-1 text-right font-mono font-bold text-slate-800">
                                  ¥{line.amount.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {detail.status === "ISSUED" && (
            <a
              href={`/api/sales-billing/${detail.id}/download-pdf`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200 transition-colors"
            >
              📥 PDFダウンロード
            </a>
          )}
          <button
            type="button"
            onClick={() => onGeneratePDF(detail.id)}
            className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-200 transition-colors"
          >
            🧾{" "}
            {detail.status === "ISSUED"
              ? "請求書PDFを再発行する"
              : "請求書PDFを発行する"}
          </button>
          <Button onClick={() => setShowMailModal(true)}>
            {/* 追加要望: PDF未発行の場合も送信時にサーバー側で自動生成されるため、
                ISSUED状態を問わず常に送信ボタンを表示する(初回送信・再送付を区別しない) */}
            📧 {detail.status === "ISSUED" ? "請求書を再送付" : "請求書を送信"}
          </Button>
        </div>

        <div className="border border-slate-200 rounded-lg p-3.5 space-y-3">
          <h4 className="text-xs font-bold text-slate-700">
            💰 入金消込を記録する
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-800">
                入金日
              </label>
              <input
                type="date"
                className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-800">
                入金額
              </label>
              <input
                type="number"
                className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(remaining)}
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-800">
                入金方法
              </label>
              <select
                className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-800">
                メモ
              </label>
              <input
                type="text"
                className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>
          {isDraft && (
            <p className="text-[11px] font-bold text-amber-800">
              ⚠️ 請求書を発行してから入金を記録できます(未発行の請求には入金を記録できません)。
            </p>
          )}
          <div className="flex justify-end">
            <Button
              variant="success"
              onClick={handleSubmitReceipt}
              disabled={isDraft || !amount || Number(amount) <= 0}
            >
              入金を記録する
            </Button>
          </div>
        </div>

        {detail.paymentReceipts.length > 0 && (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200">
              入金消込履歴
            </div>
            <div className="divide-y divide-slate-100">
              {detail.paymentReceipts.map((r) => (
                <div
                  key={r.id}
                  className="flex justify-between items-center px-3 py-2 text-xs"
                >
                  <span className="text-slate-600">
                    {r.receivedDate?.split("T")[0]}
                  </span>
                  <span className="text-slate-600">
                    {METHOD_LABELS[r.method] || r.method}
                  </span>
                  <span className="font-mono font-bold text-slate-800">
                    ¥{r.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {showMailModal && (
        <BillingMailModal
          billingHeaderId={detail.id}
          recipientEmail={recipientEmail}
          setRecipientEmail={setRecipientEmail}
          partnerContacts={partnerContacts}
          selectedContactId={selectedContactId}
          restrictToRegisteredContacts={restrictToRegisteredContacts}
          onContactSelect={onContactSelect}
          onClose={() => setShowMailModal(false)}
          onSend={onSendEmail}
          isMailSending={isMailSending}
        />
      )}
    </>
  );
}
