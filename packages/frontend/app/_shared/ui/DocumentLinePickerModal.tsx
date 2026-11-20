import React, { useEffect, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { fetchListByIdOrTitle } from "../api/search-by-id-or-title";

/**
 * REQ-029: 「伝票から明細を選ぶ」共通の部品(2段: 伝票を番号・件名で探して選ぶ → 明細と数量を選ぶ)。
 * 仕入の「発注から選択」(OrderPickerModal)・売上の「受注から選択」(SalesOrderPickerModal)・一時保管の受入/払出で使う。
 * 伝票の探し先・明細の取り方(残数量の決め方)・表の列は、呼び出し側から渡す。
 */
export interface PickerDocument {
  id: string;
  title?: string | null;
  totalAmount?: number | null;
  projectId?: string | null;
  partnerId?: string | null;
}

export interface PickerColumn<TLine> {
  /** 見出し。明細を見て決める時は関数(例: 基準が入荷済なら「入荷済数量」) */
  header: ReactNode | ((lines: TLine[]) => ReactNode);
  cell: (line: TLine) => ReactNode;
}

export interface DocumentLineSelection<TLine> {
  line: TLine;
  quantity: number;
}

interface DocumentLinePickerModalProps<TDoc extends PickerDocument, TLine> {
  /** 伝票の呼び名(例: 発注・受注) */
  docLabel: string;
  /** 伝票の一覧の API(例: /api/purchase-orders?status=APPROVED)。番号・件名で絞り込む */
  listUrl: string;
  initialSearch?: string;
  /** 選んだ伝票の明細を取る */
  loadLines: (doc: TDoc) => Promise<TLine[]>;
  lineKey: (line: TLine) => string;
  lineName: (line: TLine) => ReactNode;
  /** 選べる数量の上限(残数量)。初期値にも使う */
  remaining: (line: TLine) => number;
  /** 品目と残数量の間に出す列(基準の数量・済の数量など) */
  columns: PickerColumn<TLine>[];
  quantityHeader: string;
  /** 明細の表の上に出す注意(例: 入荷済数量が0の明細の説明) */
  notice?: (lines: TLine[]) => ReactNode;
  /** 明細が無い時の案内(既定: 「この◯◯には明細がありません」) */
  emptyLinesMessage?: string;
  /** 1件だけ選ぶ(一時保管の受入・払出) */
  single?: boolean;
  confirmLabel?: string;
  onClose: () => void;
  /** 取り込めない時は理由を返す(このモーダルに出す) */
  onApply: (doc: TDoc, selections: DocumentLineSelection<TLine>[]) => string | undefined | void;
}

export function DocumentLinePickerModal<TDoc extends PickerDocument, TLine>({
  docLabel,
  listUrl,
  initialSearch,
  loadLines,
  lineKey,
  lineName,
  remaining,
  columns,
  quantityHeader,
  notice,
  emptyLinesMessage,
  single = false,
  confirmLabel = "選択した明細を反映する",
  onClose,
  onApply,
}: DocumentLinePickerModalProps<TDoc, TLine>) {
  const [step, setStep] = useState<"PICK_DOC" | "PICK_LINES">("PICK_DOC");
  const [search, setSearch] = useState(initialSearch || "");
  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedSearch = useDebouncedValue(search);
  // 検索の結果と、その検索語。今の検索語の結果がまだ無い間は読み込み中
  const [result, setResult] = useState<{ query: string; docs: TDoc[] } | null>(null);
  const docs = result?.docs ?? [];
  const loading = result?.query !== debouncedSearch;
  const [selectedDoc, setSelectedDoc] = useState<TDoc | null>(null);
  const [lines, setLines] = useState<TLine[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    // BUG-064: 番号・件名のどちらかに一致する伝票を探す
    fetchListByIdOrTitle<TDoc>(listUrl, debouncedSearch)
      .then((list) => {
        if (!cancelled) setResult({ query: debouncedSearch, docs: list });
      })
      .catch((err) => {
        console.error(`${docLabel}一覧の取得に失敗しました`, err);
        if (!cancelled) setResult({ query: debouncedSearch, docs: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, listUrl, docLabel]);

  const handleSelectDoc = async (doc: TDoc) => {
    setError("");
    try {
      const loaded = await loadLines(doc);
      setLines(loaded);
      // 1件だけ選ぶ時は、選んだ行だけに数量を入れる(初期値は 0)
      setQuantities(Object.fromEntries(loaded.map((l) => [lineKey(l), single ? 0 : remaining(l)])));
      setSelectedDoc(doc);
      setStep("PICK_LINES");
      if (loaded.length === 0) setError(emptyLinesMessage ?? `この${docLabel}には明細がありません`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${docLabel}明細の残数量取得に失敗しました`);
    }
  };

  const handleConfirm = () => {
    if (!selectedDoc) return;
    setError("");
    const selections = lines
      .map((line) => ({ line, quantity: quantities[lineKey(line)] || 0 }))
      .filter((s) => s.quantity > 0);
    if (selections.length === 0) {
      setError("数量が1以上の明細を少なくとも1件選択してください");
      return;
    }
    if (single && selections.length > 1) {
      setError("明細は1件だけ選択してください");
      return;
    }
    const overshoot = selections.find((s) => s.quantity > remaining(s.line));
    if (overshoot) {
      setError(`[${String(lineName(overshoot.line))}] の数量が残数量(${remaining(overshoot.line)})を超えています`);
      return;
    }
    const applyError = onApply(selectedDoc, selections);
    if (applyError) setError(applyError);
  };

  return (
    <Modal
      title={
        <>
          📦 {docLabel}から明細を選択
          {step === "PICK_LINES" && selectedDoc ? ` (${selectedDoc.id})` : ""}
        </>
      }
      size="3xl"
      onClose={onClose}
    >
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg shrink-0">
          ⚠️ {error}
        </div>
      )}

      {step === "PICK_DOC" && (
        <div className="flex-1 overflow-y-auto space-y-3">
          <input
            type="text"
            placeholder={`${docLabel}コードまたは件名で絞り込み検索...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900 placeholder-slate-500 focus:border-indigo-600 focus:outline-none"
          />
          {loading ? (
            <p className="text-xs text-slate-600 text-center py-6">読み込み中...</p>
          ) : docs.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-6">承認済みの{docLabel}が見つかりません。</p>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
              {docs.map((doc) => (
                <button
                  type="button"
                  key={doc.id}
                  onClick={() => void handleSelectDoc(doc)}
                  className="w-full text-left px-3 py-2.5 hover:bg-indigo-50/50 transition-colors flex justify-between items-center text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-indigo-600">{doc.id}</span>
                    <span className="ml-2 font-semibold text-slate-700">{doc.title || "(件名なし)"}</span>
                  </div>
                  {typeof doc.totalAmount === "number" && (
                    <span className="font-mono font-bold text-slate-900">¥{doc.totalAmount.toLocaleString()}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "PICK_LINES" && (
        <>
          <div className="flex-1 overflow-y-auto">
            <div className="flex justify-between items-center mb-2">
              <p className="text-[11px] text-slate-600">
                {single
                  ? "使う明細を1件選び、数量を入れてから反映してください。"
                  : "数量(初期値は残数量)を確認・調整してから反映してください。"}
              </p>
              <button
                type="button"
                onClick={() => setStep("PICK_DOC")}
                className="text-[11px] font-bold text-slate-700 hover:text-slate-900 shrink-0 ml-2"
              >
                ← {docLabel}を選び直す
              </button>
            </div>
            {notice?.(lines)}
            {lines.length > 0 && (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b font-bold text-slate-700 sticky top-0">
                  <tr>
                    <th className="p-2">品目</th>
                    {columns.map((col, i) => (
                      <th key={i} className="p-2 text-right">
                        {typeof col.header === "function" ? col.header(lines) : col.header}
                      </th>
                    ))}
                    <th className="p-2 text-right">残数量</th>
                    <th className="p-2 text-right w-28">{quantityHeader}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line) => {
                    const key = lineKey(line);
                    const rest = remaining(line);
                    return (
                      <tr key={key} className={rest <= 0 ? "opacity-40" : ""}>
                        <td className="p-2 font-semibold text-slate-800">{lineName(line)}</td>
                        {columns.map((col, i) => (
                          <td key={i} className="p-2 text-right font-mono text-slate-900">
                            {col.cell(line)}
                          </td>
                        ))}
                        <td className="p-2 text-right font-mono font-bold text-indigo-600">{rest}</td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            min={0}
                            max={rest}
                            disabled={rest <= 0}
                            aria-label={`${String(lineName(line))}の${quantityHeader}`}
                            className="w-24 border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-white text-slate-900 text-right font-mono disabled:bg-slate-100 disabled:text-slate-500"
                            value={quantities[key] ?? 0}
                            onChange={(e) => setQuantities((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
            >
              キャンセル
            </button>
            <Button onClick={handleConfirm} disabled={lines.length === 0}>
              {confirmLabel}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
