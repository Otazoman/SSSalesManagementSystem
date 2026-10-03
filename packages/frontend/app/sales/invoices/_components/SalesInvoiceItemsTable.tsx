import React from "react";
import { Button } from "../../../_shared/ui/Button";
import { TableScroll } from "../../../_shared/ui/TableScroll";
import {
  ProductMaster,
  SalesInvoiceItem,
  UnitLookup,
  TaxCategoryLookup,
  AccountLookup,
} from "../_types";

interface SalesInvoiceItemsTableProps {
  items: SalesInvoiceItem[];
  products: ProductMaster[];
  units?: UnitLookup[];
  taxCategories?: TaxCategoryLookup[];
  accounts?: AccountLookup[];
  onItemTypeChange: (index: number, type: "MASTER" | "DIRECT") => void;
  onItemChange: (
    index: number,
    field: keyof SalesInvoiceItem,
    value: any,
  ) => void;
  onAddItemRow: () => void;
  onRemoveItemRow: (index: number) => void;
  onMoveItemUp: (index: number) => void;
  onMoveItemDown: (index: number) => void;
  calcSubTotal: () => number;
  calcGrossSubTotal: () => number;
  calcDiscountTotal: () => number;
  calcTax: () => number;
  calcTaxBreakdown?: () => {
    rate10: { excl: number; tax: number };
    rate8: { excl: number; tax: number };
    rate0: { excl: number; tax: number };
  };
  calcTotal: () => number;
}

const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500";

export function SalesInvoiceItemsTable({
  items,
  products,
  units = [],
  taxCategories = [],
  accounts = [],
  onItemTypeChange,
  onItemChange,
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
}: SalesInvoiceItemsTableProps) {
  const discountTotal = calcDiscountTotal();
  const taxBreakdown = calcTaxBreakdown?.();
  return (
    <>
      <div className="space-y-2 pt-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-bold text-slate-700">
            📋 売上構成明細
          </label>
          <Button size="sm" onClick={onAddItemRow}>
            ＋ 行を追加
          </Button>
        </div>
        <TableScroll minWidth={960}>
          <table className="w-full table-fixed text-xs text-left">
            <thead className="bg-slate-50 border-b font-bold text-slate-500">
              <tr>
                <th className="p-2 w-10 text-center">No</th>
                <th className="p-2 w-10 text-center">並替</th>
                <th className="p-2 w-28">形式</th>
                <th className="p-2">品目ID / 品目名</th>
                <th className="p-2 w-16">数量</th>
                <th className="p-2 w-24">単価 (税抜)</th>
                <th className="p-2 w-20">単位</th>
                <th className="p-2 w-36">税区分</th>
                <th className="p-2 w-24">小計金額</th>
                <th className="p-2 w-12 text-center">削除</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, idx) => (
                <React.Fragment key={idx}>
                  <tr className="hover:bg-slate-50/50">
                    <td className="p-2 font-mono text-center text-slate-600">
                      {idx + 1}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => onMoveItemUp(idx)}
                          className="text-slate-500 hover:text-indigo-600 disabled:opacity-20 disabled:pointer-events-none leading-none"
                          title="上へ移動"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          disabled={idx === items.length - 1}
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
                        className="w-full border border-slate-300 p-1 text-[11px] rounded bg-white text-slate-800 font-bold focus:outline-none"
                        value={item.inputType}
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
                      {item.sourceOrderItemId && (
                        <span className="inline-block mb-1 text-[9px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-200 rounded px-1">
                          受注明細由来
                        </span>
                      )}
                      {item.inputType === "MASTER" ? (
                        <select
                          required
                          className={inputClass}
                          value={item.itemId}
                          onChange={(e) =>
                            onItemChange(idx, "itemId", e.target.value)
                          }
                        >
                          <option value="" disabled>
                            -- 品目を選択 --
                          </option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              [{p.id}] {p.name} (¥
                              {(p.price ?? 0).toLocaleString()})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex gap-1">
                          <input
                            type="text"
                            required
                            className={`${inputClass} w-1/3`}
                            placeholder="コード自由"
                            value={item.itemId}
                            onChange={(e) =>
                              onItemChange(idx, "itemId", e.target.value)
                            }
                          />
                          <input
                            type="text"
                            required
                            className={`${inputClass} w-2/3`}
                            placeholder="自由な品目名"
                            value={item.itemName || ""}
                            onChange={(e) =>
                              onItemChange(idx, "itemName", e.target.value)
                            }
                          />
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        required
                        className={inputClass}
                        value={item.quantity}
                        onChange={(e) =>
                          onItemChange(idx, "quantity", Number(e.target.value))
                        }
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        required
                        className={inputClass}
                        value={item.unitPrice}
                        onChange={(e) =>
                          onItemChange(idx, "unitPrice", Number(e.target.value))
                        }
                      />
                    </td>
                    <td className="p-2">
                      <select
                        className={inputClass}
                        value={item.unitCode || ""}
                        onChange={(e) =>
                          onItemChange(idx, "unitCode", e.target.value)
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
                        onChange={(e) =>
                          onItemChange(idx, "taxCategoryCode", e.target.value)
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
                      className={`p-2 font-mono font-bold ${
                        (item.quantity || 0) * (item.unitPrice || 0) < 0
                          ? "text-rose-600"
                          : "text-slate-700"
                      }`}
                    >
                      {(item.quantity || 0) * (item.unitPrice || 0) < 0 && (
                        <span className="text-[9px] font-bold bg-rose-50 border border-rose-200 rounded px-1 mr-1 align-middle">
                          値引き
                        </span>
                      )}
                      ¥
                      {(
                        (item.quantity || 0) * (item.unitPrice || 0)
                      ).toLocaleString()}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        disabled={items.length === 1}
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
                          onChange={(e) =>
                            onItemChange(
                              idx,
                              "accountCode",
                              e.target.value || null,
                            )
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
                          onChange={(e) =>
                            onItemChange(idx, "memo", e.target.value)
                          }
                        />
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>

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
          {taxBreakdown ? (
            <>
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
            </>
          ) : (
            <div className="flex justify-between text-slate-500">
              <span>消費税 (10%):</span>
              <span className="font-mono">¥{calcTax().toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-1.5 font-bold text-slate-900 text-sm">
            <span>合計金額 (税込):</span>
            <span className="font-mono text-indigo-600">
              ¥{calcTotal().toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
