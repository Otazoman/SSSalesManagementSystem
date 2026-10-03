import React, { useEffect, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ApiListResponse } from "../../../_shared/api/response-types";
import {
  SourceRequisitionSummary,
  SourceRequisitionItem,
  PurchaseOrderPrefillData,
} from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { todayJst } from "../../../_shared/jst-date";

interface PurchaseRequisitionPickerModalProps {
  onClose: () => void;
  // sales/orders/_components/QuotePickerModal.tsxと同じ方針。この時点ではDBには一切書き込まない。
  // フォームへ初期値を渡して確認・調整してもらい、実際の登録は通常の保存操作で行う
  onPrefill: (data: PurchaseOrderPrefillData) => void;
}

interface RequisitionItemSelectionState {
  checked: boolean;
  quantity: number;
}

// Item9設計確定: 承認済み(APPROVED)の購買申請を起点に発注を作成する2ステップモーダル。
// ステップ1で購買申請を選び、ステップ2で「全体コピー」または「明細を選んで一部数量のみコピー」を選ぶ。
// QuotePickerModal.tsx(見積→受注)と同じ設計
export function PurchaseRequisitionPickerModal({
  onClose,
  onPrefill,
}: PurchaseRequisitionPickerModalProps) {
  const [step, setStep] = useState<"PICK_REQUISITION" | "PICK_ITEMS">(
    "PICK_REQUISITION",
  );
  const [requisitions, setRequisitions] = useState<SourceRequisitionSummary[]>(
    [],
  );
  const [search, setSearch] = useState("");
  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(false);
  const [selectedRequisition, setSelectedRequisition] =
    useState<SourceRequisitionSummary | null>(null);
  const [requisitionItems, setRequisitionItems] = useState<
    SourceRequisitionItem[]
  >([]);
  const [selections, setSelections] = useState<
    Record<string, RequisitionItemSelectionState>
  >({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<
      SourceRequisitionSummary[] | ApiListResponse<SourceRequisitionSummary>
    >(
      `/api/purchase-requisitions?status=APPROVED${debouncedSearch ? `&title=${encodeURIComponent(debouncedSearch)}` : ""}`,
    )
      .then((data) => {
        if (cancelled) return;
        setRequisitions(Array.isArray(data) ? data : data.data);
      })
      .catch((err) => {
        console.error("購買申請一覧の取得に失敗しました", err);
        if (!cancelled) setRequisitions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const handleSelectRequisition = async (
    requisition: SourceRequisitionSummary,
  ) => {
    setError("");
    setSelectedRequisition(requisition);
    try {
      const detail = await apiFetch<{ items: SourceRequisitionItem[] }>(
        `/api/purchase-requisitions/${requisition.id}`,
      );
      const items = detail.items || [];
      setRequisitionItems(items);
      const initialSelections: Record<string, RequisitionItemSelectionState> =
        {};
      items.forEach((item) => {
        initialSelections[item.id] = { checked: true, quantity: item.quantity };
      });
      setSelections(initialSelections);
      setStep("PICK_ITEMS");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "購買申請明細の取得に失敗しました",
      );
    }
  };

  const toggleSelection = (itemId: string) => {
    setSelections((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], checked: !prev[itemId].checked },
    }));
  };

  const updateSelectionQuantity = (itemId: string, quantity: number) => {
    setSelections((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], quantity },
    }));
  };

  const handleConfirm = () => {
    if (!selectedRequisition) return;
    setError("");

    const selectedItems = requisitionItems.filter(
      (item) => selections[item.id]?.checked,
    );
    if (selectedItems.length === 0) {
      setError("明細を1件以上選択してください");
      return;
    }

    const items = selectedItems.map((item) => ({
      itemId: item.itemId || "",
      itemName: item.itemName || "",
      inputType: (item.inputType === "DIRECT" ? "DIRECT" : "MASTER") as
        "MASTER" | "DIRECT",
      quantity: selections[item.id]?.quantity ?? item.quantity,
      unitPrice: item.estimatedUnitPrice,
      memo: item.memo ?? null,
      unitCode: item.unitCode ?? null,
      taxCategoryCode: item.taxCategoryCode ?? null,
      // 表示用トレーサビリティ(どの購買申請明細に由来するか)
      purchaseRequestItemId: item.id,
    }));

    onPrefill({
      title: selectedRequisition.title,
      partnerId: selectedRequisition.partnerId,
      requestId: selectedRequisition.id,
      orderDate: todayJst(),
      items,
      projectId: selectedRequisition.projectId,
    });
    onClose();
  };

  return (
    <Modal
      title={
        <>
          📝 購買申請から発注を作成{" "}
          {step === "PICK_ITEMS" && selectedRequisition
            ? `(${selectedRequisition.id})`
            : ""}
        </>
      }
      size="2xl"
      onClose={onClose}
    >
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg shrink-0">
          ⚠️ {error}
        </div>
      )}

      {step === "PICK_REQUISITION" && (
        <div className="flex-1 overflow-y-auto space-y-3">
          <input
            type="text"
            placeholder="件名で絞り込み検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none"
          />
          {loading ? (
            <p className="text-xs text-slate-600 text-center py-6">
              読み込み中...
            </p>
          ) : requisitions.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-6">
              承認済みの購買申請が見つかりません。
            </p>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
              {requisitions.map((requisition) => (
                <button
                  type="button"
                  key={requisition.id}
                  onClick={() => void handleSelectRequisition(requisition)}
                  className="w-full text-left px-3 py-2.5 hover:bg-indigo-50/50 transition-colors flex justify-between items-center text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-indigo-600">
                      {requisition.id}
                    </span>
                    <span className="ml-2 font-semibold text-slate-700">
                      {requisition.title || "(件名なし)"}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-slate-900">
                    ¥{requisition.totalAmount.toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "PICK_ITEMS" && (
        <div className="flex-1 overflow-y-auto space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-[11px] text-slate-500">
              選択した明細(数量は変更可能)を発注フォームへコピーします。まだ保存はされません。内容を確認・調整してから画面下部の保存操作で確定してください。
            </p>
            <button
              type="button"
              onClick={() => setStep("PICK_REQUISITION")}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-700 shrink-0 ml-2"
            >
              ← 購買申請を選び直す
            </button>
          </div>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b font-bold text-slate-500">
                <tr>
                  <th className="p-2 w-10 text-center">選択</th>
                  <th className="p-2">品目</th>
                  <th className="p-2 w-28">数量</th>
                  <th className="p-2 w-28 text-right">見積単価</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requisitionItems.map((item) => (
                  <tr
                    key={item.id}
                    className={selections[item.id]?.checked ? "" : "opacity-40"}
                  >
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={selections[item.id]?.checked ?? false}
                        onChange={() => toggleSelection(item.id)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="p-2 font-semibold text-slate-700">
                      {item.itemName || item.itemId}
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        disabled={!selections[item.id]?.checked}
                        value={selections[item.id]?.quantity ?? item.quantity}
                        onChange={(e) =>
                          updateSelectionQuantity(
                            item.id,
                            Number(e.target.value),
                          )
                        }
                        className="w-full border border-slate-300 p-1 text-base sm:text-xs rounded bg-white text-slate-900 disabled:bg-slate-100"
                      />
                    </td>
                    <td className="p-2 text-right font-mono text-slate-600">
                      ¥{item.estimatedUnitPrice.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === "PICK_ITEMS" && (
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border border-slate-300 text-slate-600 font-bold text-xs rounded hover:bg-slate-50"
          >
            キャンセル
          </button>
          <Button size="sm" onClick={handleConfirm}>
            発注フォームへ内容をコピー
          </Button>
        </div>
      )}
    </Modal>
  );
}
