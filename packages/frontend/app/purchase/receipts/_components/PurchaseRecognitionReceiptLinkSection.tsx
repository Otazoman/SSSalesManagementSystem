import React, { useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

interface ReceiptCandidate {
  id: string;
  receivedDate: string | null;
  supplierInvoiceNumber: string | null;
  orderId: string | null;
}

interface PurchaseRecognitionReceiptLinkSectionProps {
  partnerId: string;
  selectedReceiptIds: string[];
  onChange: (ids: string[]) => void;
}

const MAX_CANDIDATES = 200;

interface ReceiptRow {
  id: string;
  receivedDate?: string | null;
  supplierInvoiceNumber?: string | null;
  orderId?: string | null;
}

type ReceiptListResponse = ReceiptRow[] | { data?: ReceiptRow[] };

// どの仕入先に対する取得結果かを持たせ、読み込み中・仕入先未選択の表示をeffect内のsetStateなしで導く
interface LoadResult {
  partnerId: string;
  candidates: ReceiptCandidate[];
  error: string;
}

// L-1-b: この仕入の対象となる検収記録(入庫)を選ぶ。同じ納品を「検収から」「仕入から」の両方で
// 支払って二重支払になるのを、支払作成時の警告で気づけるようにするための紐づけ(任意)
export function PurchaseRecognitionReceiptLinkSection({
  partnerId,
  selectedReceiptIds,
  onChange,
}: PurchaseRecognitionReceiptLinkSectionProps) {
  const [result, setResult] = useState<LoadResult | null>(null);

  useEffect(() => {
    if (!partnerId) return;
    let cancelled = false;
    apiFetch<ReceiptListResponse>(
      `/api/stock-receipts?partnerId=${encodeURIComponent(partnerId)}&status=APPROVED&limit=${MAX_CANDIDATES}`,
    )
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data.data || [];
        setResult({
          partnerId,
          error: "",
          candidates: list.map((x) => ({
            id: x.id,
            receivedDate: x.receivedDate ?? null,
            supplierInvoiceNumber: x.supplierInvoiceNumber ?? null,
            orderId: x.orderId ?? null,
          })),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setResult({ partnerId, candidates: [], error: "検収記録の候補を取得できませんでした" });
      });
    return () => {
      cancelled = true;
    };
  }, [partnerId]);

  const isLoading = !!partnerId && result?.partnerId !== partnerId;
  const candidates = result?.partnerId === partnerId ? result.candidates : [];
  const loadError = result?.partnerId === partnerId ? result.error : "";

  const toggle = (id: string) => {
    onChange(
      selectedReceiptIds.includes(id)
        ? selectedReceiptIds.filter((x) => x !== id)
        : [...selectedReceiptIds, id],
    );
  };

  // 保存済みの紐づけが候補(先頭200件・承認済み)に出てこない場合も、選択状態が見えるよう先頭に足す
  const candidateIds = new Set(candidates.map((c) => c.id));
  const extraSelected = selectedReceiptIds.filter((id) => !candidateIds.has(id));

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-2">
      <div>
        <div className="text-xs font-bold text-slate-800">対象検収(任意)</div>
        <p className="text-[11px] text-slate-600">
          この仕入の元になった検収記録(入庫)を選ぶと、支払作成時に同じ納品の二重支払を警告できます。
        </p>
      </div>

      {!partnerId ? (
        <p className="text-[11px] text-slate-600">仕入先を選択すると、検収記録の候補が表示されます。</p>
      ) : isLoading ? (
        <p className="text-[11px] text-slate-600">読み込み中...</p>
      ) : loadError ? (
        <p className="text-[11px] text-red-700">{loadError}</p>
      ) : candidates.length === 0 && extraSelected.length === 0 ? (
        <p className="text-[11px] text-slate-600">この仕入先の承認済みの検収記録はありません。</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded">
          {extraSelected.map((id) => (
            <li key={id} className="px-2 py-1.5 text-xs bg-white text-slate-800">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked
                  onChange={() => toggle(id)}
                  className="accent-indigo-600"
                />
                <span className="font-mono">{id}</span>
                <span className="text-slate-600">(紐づけ済み)</span>
              </label>
            </li>
          ))}
          {candidates.map((c) => (
            <li key={c.id} className="px-2 py-1.5 text-xs bg-white text-slate-800">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedReceiptIds.includes(c.id)}
                  onChange={() => toggle(c.id)}
                  className="accent-indigo-600"
                />
                <span className="font-mono">{c.id}</span>
                <span className="text-slate-700">
                  {c.receivedDate ? String(c.receivedDate).split("T")[0] : ""}
                </span>
                {c.orderId && <span className="text-slate-700">発注: {c.orderId}</span>}
                {c.supplierInvoiceNumber && (
                  <span className="text-slate-700">請求書番号: {c.supplierInvoiceNumber}</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
