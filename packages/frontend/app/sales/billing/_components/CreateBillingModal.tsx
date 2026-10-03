import React, { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { DiscardCancelButton } from "../../../_shared/ui/DiscardGuard";
import {
  PartnerMaster,
  TaxCategoryLookup,
  UnbilledSalesInvoice,
} from "../_types";
import { ManualBillingItemForm } from "../_hooks/useBillingActions";
import { selectablePartners } from "../../../_shared/partner-options";

interface CreateBillingForm {
  partnerId: string;
  mode: "PER_TRANSACTION" | "PERIODIC";
  billingDate: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  memo: string;
  salesInvoiceIds: string[];
  manualItems: ManualBillingItemForm[];
}

interface CreateBillingModalProps {
  isOpen: boolean;
  partners: PartnerMaster[];
  taxCategories: TaxCategoryLookup[];
  createForm: CreateBillingForm;
  setCreateForm: React.Dispatch<React.SetStateAction<CreateBillingForm>>;
  candidateInvoices: UnbilledSalesInvoice[];
  onPartnerChange: (partnerId: string) => void;
  onToggleInvoice: (id: string) => void;
  onAddManualItem: () => void;
  onRemoveManualItem: (index: number) => void;
  onManualItemChange: (
    index: number,
    field: keyof ManualBillingItemForm,
    value: string,
  ) => void;
  onClose: () => void;
  onSubmit: () => void;
}

// Item8 Phase4: 未請求(APPROVED・billingStatus=UNBILLED)の売上一覧から対象を選び請求を作成する導線。
// K-4-3: 「売上から選択」に加え、売上計上を介さない「明細を直接入力」タブを追加した
// BUG-057: 伝票区分がSALE以外(RETURN/DISCOUNT/CORRECTION)の売上は赤伝
const isRedSlipInvoice = (inv: { documentType?: string }) =>
  !!inv.documentType && inv.documentType !== "SALE";

export function CreateBillingModal({
  isOpen,
  partners,
  taxCategories,
  createForm,
  setCreateForm,
  candidateInvoices,
  onPartnerChange,
  onToggleInvoice,
  onAddManualItem,
  onRemoveManualItem,
  onManualItemChange,
  onClose,
  onSubmit,
}: CreateBillingModalProps) {
  // K-4-3: 入力方法タブ(両方の明細を併用可能。タブはあくまで表示切替)
  const [inputTab, setInputTab] = useState<"INVOICES" | "MANUAL">("INVOICES");

  if (!isOpen) return null;

  const manualTotal = createForm.manualItems.reduce(
    (s, item) =>
      s + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
    0,
  );
  const selectedTotal =
    candidateInvoices
      .filter((inv) => createForm.salesInvoiceIds.includes(inv.id))
      // BUG-057: 赤伝(返品・値引・訂正)は差し引く(Backendの請求額の計算と同じ)
      .reduce((s, inv) => s + (isRedSlipInvoice(inv) ? -inv.totalAmount : inv.totalAmount), 0) + manualTotal;

  const totalLineCount =
    createForm.salesInvoiceIds.length + createForm.manualItems.length;
  const manualItemsValid = createForm.manualItems.every(
    (item) => item.itemName.trim().length > 0,
  );

  const canSubmit =
    !!createForm.partnerId &&
    totalLineCount > 0 &&
    manualItemsValid &&
    (createForm.mode === "PER_TRANSACTION"
      ? totalLineCount === 1
      : !!createForm.periodStart && !!createForm.periodEnd);

  return (
    <Modal warnOnDiscard title="🧮 請求の新規登録" size="2xl" onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-800">
            請求先*
          </label>
          <select
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
            value={createForm.partnerId}
            onChange={(e) => onPartnerChange(e.target.value)}
          >
            <option value="">選択してください</option>
            {selectablePartners(partners, createForm.partnerId).map((p) => (
              <option key={p.id} value={p.id}>
                [{p.id}] {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-800">
            請求方式*
          </label>
          <select
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
            value={createForm.mode}
            onChange={(e) =>
              setCreateForm((prev) => ({
                ...prev,
                mode: e.target.value as "PER_TRANSACTION" | "PERIODIC",
                salesInvoiceIds: [],
              }))
            }
          >
            <option value="PER_TRANSACTION">都度請求(対象売上1件)</option>
            <option value="PERIODIC">締め請求(複数売上を集約)</option>
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-800">
            請求日*
          </label>
          <input
            type="date"
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
            value={createForm.billingDate}
            onChange={(e) =>
              setCreateForm((prev) => ({
                ...prev,
                billingDate: e.target.value,
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
              { key: "INVOICES" as const, label: "🧾 売上から選択" },
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

          {inputTab === "INVOICES" && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200">
                対象の未請求売上(承認済み)
                {createForm.mode === "PER_TRANSACTION" && "・合計1件のみ選択可"}
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                {candidateInvoices.length === 0 ? (
                  <div className="text-center py-4 text-slate-500 text-xs italic">
                    対象の未請求売上がありません
                  </div>
                ) : (
                  candidateInvoices.map((inv) => (
                    <label
                      key={inv.id}
                      className="flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type={
                            createForm.mode === "PER_TRANSACTION"
                              ? "radio"
                              : "checkbox"
                          }
                          checked={createForm.salesInvoiceIds.includes(inv.id)}
                          onChange={() => onToggleInvoice(inv.id)}
                        />
                        <span className="font-mono font-bold text-indigo-600">
                          {inv.id}
                        </span>
                        <span className="text-slate-600">
                          {inv.invoiceDate?.split("T")[0]}
                        </span>
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {isRedSlipInvoice(inv) ? "△" : ""}¥{inv.totalAmount.toLocaleString()}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {inputTab === "MANUAL" && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border-b border-slate-200 flex justify-between items-center">
                <span>
                  明細を直接入力(売上計上を介さない請求)
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
                        placeholder="品目名*"
                        className="col-span-4 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                        value={item.itemName}
                        onChange={(e) =>
                          onManualItemChange(index, "itemName", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        placeholder="数量"
                        className="col-span-2 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                        value={item.quantity}
                        onChange={(e) =>
                          onManualItemChange(index, "quantity", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        placeholder="単価"
                        className="col-span-2 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                        value={item.unitPrice}
                        onChange={(e) =>
                          onManualItemChange(index, "unitPrice", e.target.value)
                        }
                      />
                      <select
                        className="col-span-3 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-slate-50 text-slate-900"
                        value={item.taxCategoryCode}
                        onChange={(e) =>
                          onManualItemChange(
                            index,
                            "taxCategoryCode",
                            e.target.value,
                          )
                        }
                      >
                        <option value="">税区分(既定10%)</option>
                        {taxCategories.map((tc) => (
                          <option key={tc.code} value={tc.code}>
                            {tc.name}
                          </option>
                        ))}
                      </select>
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
            請求を作成する
          </Button>
        </div>
      </div>
    </Modal>
  );
}
