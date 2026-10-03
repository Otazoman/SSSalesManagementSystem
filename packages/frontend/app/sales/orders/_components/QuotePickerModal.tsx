import React, { useEffect, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ApiListResponse } from "../../../_shared/api/response-types";
import {
  SourceQuoteSummary,
  SourceQuoteItem,
  OrderPrefillData,
} from "../_types";
import { todayJst } from "../../../_shared/jst-date";

interface QuotePickerModalProps {
  onClose: () => void;
  // Item7: この時点ではDBには一切書き込まない。フォームへ初期値を渡して確認・調整してもらい、
  // 実際の登録は通常の新規作成と同じく「保存」ボタン押下時に行う
  onPrefill: (data: OrderPrefillData) => void;
}

interface QuoteItemSelectionState {
  checked: boolean;
  quantity: number;
}

// Item7: 見積から受注を作成する2ステップモーダル。
// ステップ1で見積を選び、ステップ2で「全体コピー」または「明細を選んで一部数量のみコピー」を選ぶ。
// 明細はこの画面上でクライアント側に組み立てるだけで、DBへは一切書き込まない
// (確定登録はフォーム側の通常の保存操作で初めて行われる)
export function QuotePickerModal({
  onClose,
  onPrefill,
}: QuotePickerModalProps) {
  const [step, setStep] = useState<"PICK_QUOTE" | "PICK_ITEMS">("PICK_QUOTE");
  const [quotes, setQuotes] = useState<SourceQuoteSummary[]>([]);
  const [quoteSearch, setQuoteSearch] = useState("");
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<SourceQuoteSummary | null>(
    null,
  );
  const [quoteItems, setQuoteItems] = useState<SourceQuoteItem[]>([]);
  const [selections, setSelections] = useState<
    Record<string, QuoteItemSelectionState>
  >({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadingQuotes(true);
    apiFetch<SourceQuoteSummary[] | ApiListResponse<SourceQuoteSummary>>(
      `/api/quotes?status=APPROVED${quoteSearch ? `&title=${encodeURIComponent(quoteSearch)}` : ""}`,
    )
      .then((data) => {
        if (cancelled) return;
        setQuotes(Array.isArray(data) ? data : data.data);
      })
      .catch((err) => {
        console.error("見積一覧の取得に失敗しました", err);
        if (!cancelled) setQuotes([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingQuotes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quoteSearch]);

  const handleSelectQuote = async (quote: SourceQuoteSummary) => {
    setError("");
    setSelectedQuote(quote);
    try {
      const detail = await apiFetch<{
        items: SourceQuoteItem[];
        salesPersonEmployeeNumber?: string | null;
        projectId?: string | null;
      }>(`/api/quotes/${quote.id}`);
      const items = detail.items || [];
      setQuoteItems(items);
      // Item7残課題: 営業担当を見積から受注へ引き継ぐため、詳細取得時に選択中の見積へ反映しておく
      // (追加要望: プロジェクトも同様に引き継ぐ)
      setSelectedQuote({
        ...quote,
        salesPersonEmployeeNumber: detail.salesPersonEmployeeNumber ?? null,
        projectId: detail.projectId ?? null,
      });
      const initialSelections: Record<string, QuoteItemSelectionState> = {};
      items.forEach((item) => {
        initialSelections[item.id] = { checked: true, quantity: item.quantity };
      });
      setSelections(initialSelections);
      setStep("PICK_ITEMS");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "見積明細の取得に失敗しました",
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
    if (!selectedQuote) return;
    setError("");

    const selectedItems = quoteItems.filter(
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
      unitPrice: item.unitPrice,
      costPrice: item.costPrice ?? null,
      memo: item.memo ?? null,
      unitCode: item.unitCode ?? null,
      taxCategoryCode: item.taxCategoryCode ?? null,
      // Item7: どの見積明細に由来するかの表示用トレーサビリティ(消込判定には使わない)
      sourceQuoteItemId: item.id,
    }));

    onPrefill({
      title: selectedQuote.title,
      partnerId: selectedQuote.partnerId,
      sourceQuoteId: selectedQuote.id,
      orderDate: todayJst(),
      items,
      salesPersonEmployeeNumber:
        selectedQuote.salesPersonEmployeeNumber ?? null,
      projectId: selectedQuote.projectId ?? null,
    });
    onClose();
  };

  return (
    <Modal
      title={
        <>
          📄 見積から受注を作成{" "}
          {step === "PICK_ITEMS" && selectedQuote
            ? `(${selectedQuote.id})`
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

      {step === "PICK_QUOTE" && (
        <div className="flex-1 overflow-y-auto space-y-3">
          <input
            type="text"
            placeholder="件名で絞り込み検索..."
            value={quoteSearch}
            onChange={(e) => setQuoteSearch(e.target.value)}
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none"
          />
          {loadingQuotes ? (
            <p className="text-xs text-slate-600 text-center py-6">
              読み込み中...
            </p>
          ) : quotes.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-6">
              承認済みの見積が見つかりません。
            </p>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
              {quotes.map((quote) => (
                <button
                  type="button"
                  key={quote.id}
                  onClick={() => void handleSelectQuote(quote)}
                  className="w-full text-left px-3 py-2.5 hover:bg-indigo-50/50 transition-colors flex justify-between items-center text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-indigo-600">
                      {quote.id}
                    </span>
                    <span className="ml-2 font-semibold text-slate-700">
                      {quote.title || "(件名なし)"}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-slate-900">
                    ¥{quote.totalAmount.toLocaleString()}
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
              選択した明細(数量は変更可能)を受注フォームへコピーします。まだ保存はされません。内容を確認・調整してから画面下部の保存操作で確定してください。
            </p>
            <button
              type="button"
              onClick={() => setStep("PICK_QUOTE")}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-700 shrink-0 ml-2"
            >
              ← 見積を選び直す
            </button>
          </div>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b font-bold text-slate-500">
                <tr>
                  <th className="p-2 w-10 text-center">選択</th>
                  <th className="p-2">品目</th>
                  <th className="p-2 w-28">数量</th>
                  <th className="p-2 w-28 text-right">単価</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {quoteItems.map((item) => (
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
                      ¥{item.unitPrice.toLocaleString()}
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
            受注フォームへ内容をコピー
          </Button>
        </div>
      )}
    </Modal>
  );
}
