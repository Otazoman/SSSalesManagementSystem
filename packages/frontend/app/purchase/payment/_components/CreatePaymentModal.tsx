import React, { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { DiscardCancelButton } from "../../../_shared/ui/DiscardGuard";
import {
  PartnerMaster,
  UnpaidPurchaseRecognition,
  CandidateItemReceipt,
} from "../_types";
import {
  ItemReceiptSelectionForm,
  ManualPaymentItemForm,
} from "../_hooks/usePaymentActions";

interface CreatePaymentForm {
  partnerId: string;
  mode: "PER_TRANSACTION" | "PERIODIC";
  paymentDate: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  memo: string;
  purchaseRecognitionIds: string[];
  itemReceiptSelections: ItemReceiptSelectionForm[];
  manualItems: ManualPaymentItemForm[];
}

interface CreatePaymentModalProps {
  isOpen: boolean;
  partners: PartnerMaster[];
  createForm: CreatePaymentForm;
  setCreateForm: React.Dispatch<React.SetStateAction<CreatePaymentForm>>;
  candidateRecognitions: UnpaidPurchaseRecognition[];
  candidateItemReceipts: CandidateItemReceipt[];
  onPartnerChange: (partnerId: string) => void;
  onToggleRecognition: (id: string) => void;
  onToggleItemReceipt: (candidate: CandidateItemReceipt) => void;
  onItemReceiptAmountChange: (
    id: string,
    field: "amount" | "taxAmount",
    value: string,
  ) => void;
  onAddManualItem: () => void;
  onRemoveManualItem: (index: number) => void;
  onManualItemChange: (
    index: number,
    field: keyof ManualPaymentItemForm,
    value: string,
  ) => void;
  onClose: () => void;
  onSubmit: () => void;
}

// Item10 Phase5: 未払(APPROVED・paymentStatus=UNPAID)の仕入一覧から対象を選び支払を確定する導線。
// K-5-1: 「検収から選択」(仕入計上を介さない検収記録)、K-5-3: 「明細を直接入力」(完全手動)を追加した
export function CreatePaymentModal({
  isOpen,
  partners,
  createForm,
  setCreateForm,
  candidateRecognitions,
  candidateItemReceipts,
  onPartnerChange,
  onToggleRecognition,
  onToggleItemReceipt,
  onItemReceiptAmountChange,
  onAddManualItem,
  onRemoveManualItem,
  onManualItemChange,
  onClose,
  onSubmit,
}: CreatePaymentModalProps) {
  // K-5-1/K-5-3: 入力方法タブ(3つの起点は併用可能。タブはあくまで表示切替)
  const [inputTab, setInputTab] = useState<
    "RECOGNITIONS" | "RECEIPTS" | "MANUAL"
  >("RECOGNITIONS");

  if (!isOpen) return null;

  // K-5-2: 前払済み(isAdvancePrepaid)の仕入は選択しても金額¥0扱いになるため合計に含めない
  const recognitionsTotal = candidateRecognitions
    .filter(
      (rec) =>
        createForm.purchaseRecognitionIds.includes(rec.id) &&
        !rec.isAdvancePrepaid,
    )
    .reduce((s, rec) => s + rec.totalAmount, 0);
  const itemReceiptsTotal = createForm.itemReceiptSelections.reduce(
    (s, sel) => s + (Number(sel.amount) || 0),
    0,
  );
  const manualTotal = createForm.manualItems.reduce(
    (s, item) => s + (Number(item.amount) || 0),
    0,
  );
  const selectedTotal = recognitionsTotal + itemReceiptsTotal + manualTotal;

  const totalLineCount =
    createForm.purchaseRecognitionIds.length +
    createForm.itemReceiptSelections.length +
    createForm.manualItems.length;
  const manualItemsValid = createForm.manualItems.every(
    (item) => item.itemName.trim().length > 0,
  );
  const itemReceiptsValid = createForm.itemReceiptSelections.every(
    (sel) => !sel.requiresManualAmount || Number(sel.amount) > 0,
  );

  // L-1-b: 同じ納品の仕入と検収を同じ支払に両方選んでいる組(二重計上の疑い)。警告のみで送信は妨げない
  const selectedReceiptIds = new Set(
    createForm.itemReceiptSelections.map((s) => s.id),
  );
  const duplicatedPairs = candidateRecognitions
    .filter((rec) => createForm.purchaseRecognitionIds.includes(rec.id))
    .flatMap((rec) =>
      (rec.linkedReceiptIds ?? [])
        .filter((receiptId) => selectedReceiptIds.has(receiptId))
        .map((receiptId) => ({ recognitionId: rec.id, receiptId })),
    );

  const canSubmit =
    !!createForm.partnerId &&
    totalLineCount > 0 &&
    manualItemsValid &&
    itemReceiptsValid &&
    (createForm.mode === "PER_TRANSACTION"
      ? totalLineCount === 1
      : !!createForm.periodStart && !!createForm.periodEnd);

  return (
    <Modal warnOnDiscard title="💳 支払の新規登録" size="2xl" onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-800">
            支払先*
          </label>
          <select
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
            value={createForm.partnerId}
            onChange={(e) => onPartnerChange(e.target.value)}
          >
            <option value="">選択してください</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.id}] {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-800">
            支払方式*
          </label>
          <select
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
            value={createForm.mode}
            onChange={(e) =>
              setCreateForm((prev) => ({
                ...prev,
                mode: e.target.value as "PER_TRANSACTION" | "PERIODIC",
                purchaseRecognitionIds: [],
                itemReceiptSelections: [],
                manualItems: [],
              }))
            }
          >
            <option value="PER_TRANSACTION">都度支払(対象1件)</option>
            <option value="PERIODIC">締め支払(複数対象を集約)</option>
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-800">
            支払日*
          </label>
          <input
            type="date"
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
            value={createForm.paymentDate}
            onChange={(e) =>
              setCreateForm((prev) => ({
                ...prev,
                paymentDate: e.target.value,
              }))
            }
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-800">件名</label>
          <input
            type="text"
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
            value={createForm.title}
            onChange={(e) =>
              setCreateForm((prev) => ({ ...prev, title: e.target.value }))
            }
          />
        </div>
        {createForm.mode === "PERIODIC" && (
          <>
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-800">
                対象期間(開始)*
              </label>
              <input
                type="date"
                className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                value={createForm.periodStart}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    periodStart: e.target.value,
                  }))
                }
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-800">
                対象期間(終了)*
              </label>
              <input
                type="date"
                className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                value={createForm.periodEnd}
                onChange={(e) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    periodEnd: e.target.value,
                  }))
                }
              />
            </div>
          </>
        )}
      </div>

      {createForm.partnerId && (
        <div className="space-y-3">
          <div className="flex space-x-1 border-b border-slate-200">
            {[
              { key: "RECOGNITIONS" as const, label: "📋 仕入から選択" },
              { key: "RECEIPTS" as const, label: "📦 検収から選択" },
              { key: "MANUAL" as const, label: "✍️ 明細を直接入力" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setInputTab(t.key)}
                className={`px-3 py-1.5 text-xs font-bold rounded-t cursor-pointer transition-colors ${
                  inputTab === t.key
                    ? "bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {duplicatedPairs.length > 0 && (
            <div
              role="alert"
              className="border border-amber-300 bg-amber-50 text-amber-900 text-xs font-bold rounded-lg px-3 py-2"
            >
              ⚠ 同じ納品の仕入と検収を両方選択しています(二重支払の可能性)。
              {duplicatedPairs.map((p) => (
                <div
                  key={`${p.recognitionId}-${p.receiptId}`}
                  className="font-normal font-mono"
                >
                  仕入[{p.recognitionId}] と 検収[{p.receiptId}]
                </div>
              ))}
            </div>
          )}

          {inputTab === "RECOGNITIONS" && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200">
                対象の未払仕入(承認済み)
                {createForm.mode === "PER_TRANSACTION" && "・合計1件のみ選択可"}
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                {candidateRecognitions.length === 0 ? (
                  <div className="text-center py-4 text-slate-500 text-xs italic">
                    対象の未払仕入がありません
                  </div>
                ) : (
                  candidateRecognitions.map((rec) => (
                    <label
                      key={rec.id}
                      className="flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type={
                            createForm.mode === "PER_TRANSACTION"
                              ? "radio"
                              : "checkbox"
                          }
                          checked={createForm.purchaseRecognitionIds.includes(
                            rec.id,
                          )}
                          onChange={() => onToggleRecognition(rec.id)}
                        />
                        <span className="font-mono font-bold text-indigo-600">
                          {rec.id}
                        </span>
                        <span className="text-slate-600">
                          {rec.recognitionDate?.split("T")[0]}
                        </span>
                        {rec.isAdvancePrepaid && (
                          <span
                            className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded"
                            title={`発注[${rec.advanceOrderId}]で前払済み`}
                          >
                            前払済み
                          </span>
                        )}
                        {rec.linkedReceiptPaid && (
                          <span
                            className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
                            title={`紐づく検収記録[${(rec.linkedReceiptIds ?? []).join(", ")}]が既に支払対象になっています`}
                          >
                            ⚠ 同じ納品の検収が支払対象済み
                          </span>
                        )}
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {rec.isAdvancePrepaid ? (
                          <span className="text-emerald-700">
                            ¥0(前払で相殺)
                          </span>
                        ) : (
                          `¥${rec.totalAmount.toLocaleString()}`
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {inputTab === "RECEIPTS" && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200">
                対象の検収記録(承認済み・未使用、仕入計上を介さず直接支払対象にする)
                {createForm.mode === "PER_TRANSACTION" && "・合計1件のみ選択可"}
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                {candidateItemReceipts.length === 0 ? (
                  <div className="text-center py-4 text-slate-500 text-xs italic">
                    対象の検収記録がありません
                  </div>
                ) : (
                  candidateItemReceipts.map((c) => {
                    const selection = createForm.itemReceiptSelections.find(
                      (s) => s.id === c.id,
                    );
                    const isSelected = !!selection;
                    return (
                      <div key={c.id} className="px-3 py-2 text-xs space-y-1.5">
                        <label className="flex items-center justify-between cursor-pointer">
                          <span className="flex items-center gap-2">
                            <input
                              type={
                                createForm.mode === "PER_TRANSACTION"
                                  ? "radio"
                                  : "checkbox"
                              }
                              checked={isSelected}
                              onChange={() => onToggleItemReceipt(c)}
                            />
                            <span className="font-mono font-bold text-indigo-600">
                              {c.id}
                            </span>
                            <span className="text-slate-600">
                              {c.receivedDate?.split("T")[0]}
                            </span>
                            {c.linkedRecognitionPaid && (
                              <span
                                className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
                                title={`紐づく仕入[${(c.linkedRecognitionIds ?? []).join(", ")}]が既に支払済みです`}
                              >
                                ⚠ 同じ納品の仕入が支払済み
                              </span>
                            )}
                          </span>
                          {c.requiresManualAmount ? (
                            <span className="text-amber-600 font-bold">
                              ⚠ 単価情報なし・金額要入力
                            </span>
                          ) : (
                            <span className="font-mono font-bold text-slate-800">
                              ¥{(c.computedAmount ?? 0).toLocaleString()}
                            </span>
                          )}
                        </label>
                        {isSelected && selection.requiresManualAmount && (
                          <div className="flex gap-2 pl-5">
                            <input
                              type="number"
                              placeholder="金額(税込)*"
                              className="flex-1 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                              value={selection.amount}
                              onChange={(e) =>
                                onItemReceiptAmountChange(
                                  c.id,
                                  "amount",
                                  e.target.value,
                                )
                              }
                            />
                            <input
                              type="number"
                              placeholder="内消費税"
                              className="flex-1 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                              value={selection.taxAmount}
                              onChange={(e) =>
                                onItemReceiptAmountChange(
                                  c.id,
                                  "taxAmount",
                                  e.target.value,
                                )
                              }
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {inputTab === "MANUAL" && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200 flex justify-between items-center">
                <span>
                  明細を直接入力(購買申請・発注・検収・仕入計上いずれにも紐づかない支払)
                  {createForm.mode === "PER_TRANSACTION" &&
                    "・合計1件のみ入力可"}
                </span>
                <button
                  type="button"
                  onClick={onAddManualItem}
                  disabled={
                    createForm.mode === "PER_TRANSACTION" && totalLineCount >= 1
                  }
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 disabled:text-slate-500 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  ＋行を追加
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {createForm.manualItems.length === 0 ? (
                  <div className="text-center py-4 text-slate-500 text-xs italic">
                    「＋行を追加」で明細を入力してください
                  </div>
                ) : (
                  createForm.manualItems.map((item, index) => (
                    <div
                      key={index}
                      className="px-3 py-2 grid grid-cols-12 gap-2 items-center text-xs"
                    >
                      <input
                        type="text"
                        placeholder="品目名・摘要*"
                        className="col-span-5 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                        value={item.itemName}
                        onChange={(e) =>
                          onManualItemChange(index, "itemName", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        placeholder="金額(税込)"
                        className="col-span-3 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                        value={item.amount}
                        onChange={(e) =>
                          onManualItemChange(index, "amount", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        placeholder="内消費税"
                        className="col-span-3 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                        value={item.taxAmount}
                        onChange={(e) =>
                          onManualItemChange(index, "taxAmount", e.target.value)
                        }
                      />
                      <button
                        type="button"
                        onClick={() => onRemoveManualItem(index)}
                        className="col-span-1 text-red-400 hover:text-red-600 text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-slate-100">
        <span className="text-xs font-bold text-slate-600">
          選択合計:{" "}
          <span className="text-indigo-600 font-mono">
            ¥{selectedTotal.toLocaleString()}
          </span>
        </span>
        <div className="flex gap-2">
          <DiscardCancelButton
            onCancel={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
          />
          <Button onClick={onSubmit} disabled={!canSubmit}>
            支払を確定する
          </Button>
        </div>
      </div>
    </Modal>
  );
}
