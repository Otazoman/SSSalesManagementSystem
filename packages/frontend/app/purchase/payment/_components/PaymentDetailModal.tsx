import React, { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { PaymentDetail } from "../_types";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import { METHOD_LABELS } from "../../../_shared/payment-method-labels";
import { todayJst } from "../../../_shared/jst-date";

interface PaymentDetailModalProps {
  detail: PaymentDetail | null;
  onClose: () => void;
  onRecordDisbursement: (
    paymentHeaderId: string,
    payload: {
      paidDate: string;
      amount: number;
      method: string;
      memo?: string;
    },
  ) => Promise<boolean>;
}

// Item10 Phase5: 支払内容の確認・手動消込入力を行う詳細モーダル(PDF発行は仕入側に無いため対象外)
export function PaymentDetailModal({
  detail,
  onClose,
  onRecordDisbursement,
}: PaymentDetailModalProps) {
  const [paidDate, setPaidDate] = useState(
    todayJst(),
  );
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [memo, setMemo] = useState("");

  if (!detail) return null;

  const remaining = Math.max(detail.totalAmount - detail.reconciledAmount, 0);

  const handleSubmitDisbursement = async () => {
    const amountNumber = Number(amount);
    if (!amountNumber || amountNumber <= 0) return;
    const success = await onRecordDisbursement(detail.id, {
      paidDate,
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
    <Modal
      title={
        <>
          📄 支払詳細 [{detail.id}]
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
      <DocumentCompletionControl stageKey="payment" documentId={detail.id} />

      <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-lg p-3.5 border border-slate-200/80 text-xs">
        <div>
          <span className="text-slate-600 font-bold block">支払日</span>
          <span className="font-bold text-slate-800">
            {detail.paymentDate?.split("T")[0]}
          </span>
        </div>
        <div>
          <span className="text-slate-600 font-bold block">方式</span>
          <span className="font-bold text-slate-800">
            {detail.mode === "PER_TRANSACTION" ? "都度支払" : "締め支払"}
          </span>
        </div>
        <div>
          <span className="text-slate-600 font-bold block">合計金額(税込)</span>
          <span className="font-mono font-black text-indigo-600">
            ¥{detail.totalAmount.toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-slate-600 font-bold block">消込済/未消込</span>
          <span className="font-mono font-bold text-slate-800">
            ¥{detail.reconciledAmount.toLocaleString()} / ¥
            {remaining.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200">
          対象明細
        </div>
        <div className="divide-y divide-slate-100">
          {detail.items.map((item) => (
            <div
              key={item.id}
              className="flex justify-between items-center px-3 py-2 text-xs"
            >
              {item.purchaseRecognitionId ? (
                <span className="flex items-center gap-2">
                  <span className="font-mono font-bold text-indigo-600">
                    {item.purchaseRecognitionId}
                  </span>
                  <span className="text-slate-600">
                    {item.purchaseRecognition?.recognitionDate?.split("T")[0]}
                  </span>
                  {item.advanceOrder && (
                    <span
                      className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded"
                      title={`発注[${item.advanceOrder.id}]で前払済み(¥${item.advanceOrder.totalAmount.toLocaleString()})`}
                    >
                      前払済み
                    </span>
                  )}
                </span>
              ) : item.itemReceiptId ? (
                <span className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">
                    検収
                  </span>
                  <span className="font-mono font-bold text-indigo-600">
                    {item.itemReceiptId}
                  </span>
                  <span className="text-slate-600">
                    {item.itemReceipt?.receivedDate?.split("T")[0]}
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                    直接入力
                  </span>
                  <span className="text-slate-700">{item.itemName}</span>
                </span>
              )}
              <span className="font-mono font-bold text-slate-800">
                ¥{item.amount.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg p-3.5 space-y-3">
        <h4 className="text-xs font-bold text-slate-700">
          💰 支払消込を記録する
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              支払日
            </label>
            <input
              type="date"
              className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              支払額
            </label>
            <input
              type="number"
              className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(remaining)}
            />
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              支払方法
            </label>
            <select
              className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
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
            <label className="text-[10px] font-bold text-slate-500">メモ</label>
            <input
              type="text"
              className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="success"
            onClick={handleSubmitDisbursement}
            disabled={!amount || Number(amount) <= 0}
          >
            支払を記録する
          </Button>
        </div>
      </div>

      {detail.disbursements.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200">
            支払消込履歴
          </div>
          <div className="divide-y divide-slate-100">
            {detail.disbursements.map((d) => (
              <div
                key={d.id}
                className="flex justify-between items-center px-3 py-2 text-xs"
              >
                <span className="text-slate-600">
                  {d.paidDate?.split("T")[0]}
                </span>
                <span className="text-slate-600">
                  {METHOD_LABELS[d.method] || d.method}
                </span>
                <span className="font-mono font-bold text-slate-800">
                  ¥{d.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
