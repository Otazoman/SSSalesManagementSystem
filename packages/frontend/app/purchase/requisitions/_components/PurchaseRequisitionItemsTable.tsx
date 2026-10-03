import React from "react";
import { Button } from "../../../_shared/ui/Button";
import {
  PurchaseRequisitionItemRecord,
  ItemMaster,
  UnitLookup,
  TaxCategoryLookup,
  AccountLookup,
} from "../_types";

interface PurchaseRequisitionItemsTableProps {
  items: PurchaseRequisitionItemRecord[];
  allItems: ItemMaster[];
  units: UnitLookup[];
  taxCategories: TaxCategoryLookup[];
  accounts?: AccountLookup[];
  isLocked: boolean;
  onItemTypeChange: (index: number, type: "MASTER" | "DIRECT") => void;
  onItemChange: (
    index: number,
    patch: Partial<PurchaseRequisitionItemRecord>,
  ) => void;
  // マスタ選択時に単位/税区分/仕入単価を自動反映する(見積のhandleItemChangeと同じ方針)
  onItemMasterSelect: (index: number, itemId: string) => void;
  // 数量変更時、マスタ選択済みの行は数量帯に応じた仕入単価を再取得する
  onItemQuantityChange: (index: number, quantity: number) => void;
  onAddItemRow: () => void;
  onRemoveItemRow: (index: number) => void;
  onMoveItemUp: (index: number) => void;
  onMoveItemDown: (index: number) => void;
  calcSubTotal: () => number;
  calcGrossSubTotal: () => number;
  calcDiscountTotal: () => number;
  calcTax: () => number;
  calcTaxBreakdown: () => {
    rate10: { excl: number; tax: number };
    rate8: { excl: number; tax: number };
    rate0: { excl: number; tax: number };
  };
  calcTotal: () => number;
}

// QuoteItemsTable.tsxと同じ列構成(No/並べ替え/形式/品目識別ID・品目名/数量/単価/単位/税区分/小計金額/削除)+
// 集計フッター。K-2-b: 明細単位の勘定科目(任意、未設定なら品目マスタのaccountCodeを使う)を
// 備考行に併設(ヘッダーへは追加しない、J-2-eの方針を維持)
const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500";

export function PurchaseRequisitionItemsTable({
  items,
  allItems,
  units,
  taxCategories,
  accounts = [],
  isLocked,
  onItemTypeChange,
  onItemChange,
  onItemMasterSelect,
  onItemQuantityChange,
  onAddItemRow,
  onRemoveItemRow,
  onMoveItemUp,
  onMoveItemDown,
  calcSubTotal,
  calcGrossSubTotal,
  calcDiscountTotal,
  calcTax,
  calcTaxBreakdown,
  calcTotal,
}: PurchaseRequisitionItemsTableProps) {
  const discountTotal = calcDiscountTotal();
  const taxBreakdown = calcTaxBreakdown();

  return (
    <div className="space-y-2 pt-2">
      <div className="flex justify-between items-center">
        <label className="text-xs font-bold text-slate-700">
          📋 購買申請明細
        </label>
        <Button size="sm" onClick={onAddItemRow} disabled={isLocked}>
          ＋ 行を追加
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-[11px] text-slate-600">
          明細行がありません。「行を追加」から入力してください。
        </p>
      )}

      {items.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b font-bold text-slate-500">
              <tr>
                <th className="p-2 w-10 text-center">No</th>
                <th className="p-2 w-10 text-center">並替</th>
                <th className="p-2">形式</th>
                <th className="p-2">品目ID / 品目名</th>
                <th className="p-2">数量</th>
                <th className="p-2">単価</th>
                <th className="p-2">単位</th>
                <th className="p-2">税区分</th>
                <th className="p-2">小計金額</th>
                <th className="p-2 w-10 text-center">削除</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, idx) => {
                const inputType = item.inputType || "MASTER";
                const amount =
                  (item.quantity || 0) * (item.estimatedUnitPrice || 0);
                return (
                  <React.Fragment key={idx}>
                    <tr className="hover:bg-slate-50/50 align-top">
                      <td className="p-2 font-mono text-center text-slate-600">
                        {idx + 1}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            type="button"
                            disabled={isLocked || idx === 0}
                            onClick={() => onMoveItemUp(idx)}
                            className="text-slate-500 hover:text-indigo-600 disabled:opacity-20 disabled:pointer-events-none leading-none"
                            title="上へ移動"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            disabled={isLocked || idx === items.length - 1}
                            onClick={() => onMoveItemDown(idx)}
                            className="text-slate-500 hover:text-indigo-600 disabled:opacity-20 disabled:pointer-events-none leading-none"
                            title="下へ移動"
                          >
                            ▼
                          </button>
                        </div>
                      </td>
                      <td className="p-2">
                        <select
                          className="w-full border border-slate-300 p-1 text-[11px] rounded bg-white text-slate-800 font-bold focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
                          value={inputType}
                          disabled={isLocked}
                          onChange={(e) =>
                            onItemTypeChange(
                              idx,
                              e.target.value as "MASTER" | "DIRECT",
                            )
                          }
                        >
                          <option value="MASTER">マスタ選択</option>
                          <option value="DIRECT">手入力</option>
                        </select>
                      </td>
                      <td className="p-2">
                        {inputType === "MASTER" ? (
                          <select
                            required
                            className={inputClass}
                            value={item.itemId}
                            disabled={isLocked}
                            onChange={(e) =>
                              onItemMasterSelect(idx, e.target.value)
                            }
                          >
                            <option value="" disabled>
                              -- 品目を選択 --
                            </option>
                            {allItems.map((i) => (
                              <option key={i.id} value={i.id}>
                                [{i.id}] {i.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <input
                              type="text"
                              required
                              className={inputClass}
                              placeholder="コード自由"
                              value={item.itemId}
                              disabled={isLocked}
                              onChange={(e) =>
                                onItemChange(idx, { itemId: e.target.value })
                              }
                            />
                            <input
                              type="text"
                              required
                              className={inputClass}
                              placeholder="自由な品目名"
                              value={item.itemName || ""}
                              disabled={isLocked}
                              onChange={(e) =>
                                onItemChange(idx, { itemName: e.target.value })
                              }
                            />
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="any"
                          required
                          className={inputClass}
                          value={item.quantity}
                          disabled={isLocked}
                          onChange={(e) =>
                            onItemQuantityChange(idx, Number(e.target.value))
                          }
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="any"
                          required
                          className={inputClass}
                          value={item.estimatedUnitPrice}
                          disabled={isLocked}
                          onChange={(e) =>
                            onItemChange(idx, {
                              estimatedUnitPrice: Number(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="p-2">
                        <select
                          className={inputClass}
                          value={item.unitCode || ""}
                          disabled={isLocked}
                          onChange={(e) =>
                            onItemChange(idx, { unitCode: e.target.value })
                          }
                        >
                          <option value="">-- 未選択 --</option>
                          {units.map((u) => (
                            <option key={u.code} value={u.code}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <select
                          className={inputClass}
                          value={item.taxCategoryCode || ""}
                          disabled={isLocked}
                          onChange={(e) =>
                            onItemChange(idx, {
                              taxCategoryCode: e.target.value,
                            })
                          }
                        >
                          <option value="">-- 未選択 --</option>
                          {taxCategories.map((t) => (
                            <option key={t.code} value={t.code}>
                              {t.name} (
                              {t.taxType === "EXEMPT"
                                ? "非課税"
                                : `${(t.taxRate * 100).toFixed(0)}%`}
                              )
                            </option>
                          ))}
                        </select>
                      </td>
                      <td
                        className={`p-2 font-mono font-bold ${amount < 0 ? "text-rose-600" : "text-slate-700"}`}
                      >
                        {amount < 0 && (
                          <span className="text-[9px] font-bold bg-rose-50 border border-rose-200 rounded px-1 mr-1 align-middle">
                            値引き
                          </span>
                        )}
                        ¥{amount.toLocaleString()}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => onRemoveItemRow(idx)}
                          className="text-red-500 font-bold disabled:opacity-30"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td colSpan={10} className="px-2 pb-2 pt-0">
                        <div className="flex gap-1">
                          <select
                            className={`${inputClass} bg-white w-1/3`}
                            value={item.accountCode || ""}
                            disabled={isLocked}
                            onChange={(e) =>
                              onItemChange(idx, {
                                accountCode: e.target.value || null,
                              })
                            }
                          >
                            <option value="">勘定科目(品目マスタに従う)</option>
                            {accounts.map((a) => (
                              <option key={a.code} value={a.code}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            className={`${inputClass} bg-white w-2/3`}
                            placeholder="明細備考(任意)"
                            value={item.memo || ""}
                            disabled={isLocked}
                            onChange={(e) =>
                              onItemChange(idx, { memo: e.target.value })
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 w-full sm:w-72 space-y-1.5 text-xs">
          <div className="flex justify-between text-slate-500">
            <span>小計 (値引き前・税抜):</span>
            <span className="font-mono">
              ¥{calcGrossSubTotal().toLocaleString()}
            </span>
          </div>
          {discountTotal < 0 && (
            <div className="flex justify-between text-rose-600">
              <span>値引き合計:</span>
              <span className="font-mono">
                -¥{Math.abs(discountTotal).toLocaleString()}
              </span>
            </div>
          )}
          <div className="flex justify-between text-slate-500">
            <span>税抜金額小計:</span>
            <span className="font-mono">
              ¥{calcSubTotal().toLocaleString()}
            </span>
          </div>
          {taxBreakdown.rate10.excl !== 0 && (
            <div className="flex justify-between text-slate-500">
              <span>消費税 (10%対象):</span>
              <span className="font-mono">
                ¥{taxBreakdown.rate10.tax.toLocaleString()}
              </span>
            </div>
          )}
          {taxBreakdown.rate8.excl !== 0 && (
            <div className="flex justify-between text-slate-500">
              <span>消費税 (8%対象):</span>
              <span className="font-mono">
                ¥{taxBreakdown.rate8.tax.toLocaleString()}
              </span>
            </div>
          )}
          {taxBreakdown.rate0.excl !== 0 && (
            <div className="flex justify-between text-slate-500">
              <span>非課税分:</span>
              <span className="font-mono">
                ¥{taxBreakdown.rate0.excl.toLocaleString()}
              </span>
            </div>
          )}
          <div className="flex justify-between text-slate-500">
            <span>消費税合計:</span>
            <span className="font-mono">¥{calcTax().toLocaleString()}</span>
          </div>
          <div className="flex justify-between border-t pt-1.5 font-bold text-slate-900 text-sm">
            <span>合計金額 (税込):</span>
            <span className="font-mono text-indigo-600">
              ¥{calcTotal().toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
