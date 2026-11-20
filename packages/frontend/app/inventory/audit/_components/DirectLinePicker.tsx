"use client";

import { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

// REQ-029: 一時保管で、発注番号・受注番号を検索して、伝票の直接入力(品目マスタに無い)の明細を選ぶ。
// 受入は発注の明細、払出は受注の明細を選ぶ(サーバーも直接入力の明細だけを受け付ける)
export interface PickedDirectLine {
  orderId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  partnerId: string | null;
}

const CONFIG = {
  purchase: { label: "発注", api: "/api/purchase-orders" },
  sales: { label: "受注", api: "/api/sales-orders" },
} as const;

interface OrderSummary {
  id: string;
  title?: string | null;
  partnerId?: string | null;
}

interface OrderDetail {
  id: string;
  partnerId?: string | null;
  items: Array<{ id: string; itemName: string | null; quantity: number; inputType?: string | null }>;
}

interface Props {
  kind: keyof typeof CONFIG;
  onPick: (line: PickedDirectLine) => void;
}

export function DirectLinePicker({ kind, onPick }: Props) {
  const config = CONFIG[kind];
  const [keyword, setKeyword] = useState("");
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const search = async () => {
    setError("");
    setSelected(null);
    if (!keyword.trim()) {
      setError(`${config.label}番号を入力してください`);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<OrderSummary[] | { data: OrderSummary[] }>(
        `${config.api}?id=${encodeURIComponent(keyword.trim())}`,
      );
      setOrders((Array.isArray(data) ? data : data.data || []).slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : `${config.label}の検索に失敗しました`);
    } finally {
      setLoading(false);
    }
  };

  const open = async (orderId: string) => {
    setError("");
    setLoading(true);
    try {
      setSelected(await apiFetch<OrderDetail>(`${config.api}/${encodeURIComponent(orderId)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : `${config.label}の取得に失敗しました`);
    } finally {
      setLoading(false);
    }
  };

  const directLines = (selected?.items ?? []).filter((i) => i.inputType === "DIRECT");

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      <p className="text-xs font-bold text-slate-800">🔍 {config.label}番号から選ぶ(任意)</p>
      <div className="flex gap-2">
        <input
          className={formFieldInputClass}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder={`${config.label}番号(一部でも可)`}
          aria-label={`${config.label}番号`}
        />
        <Button size="sm" onClick={() => void search()} disabled={loading}>
          検索
        </Button>
      </div>
      {error && <p className="text-[11px] font-bold text-red-700">⚠️ {error}</p>}

      {orders && !selected && (
        orders.length === 0 ? (
          <p className="text-xs text-slate-600">該当する{config.label}がありません。</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white text-xs">
            {orders.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => void open(o.id)}
                  className="w-full px-2 py-1.5 text-left text-slate-800 hover:bg-indigo-50"
                >
                  <span className="font-mono font-bold text-indigo-700">{o.id}</span>
                  <span className="ml-2">{o.title || "(件名なし)"}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {selected && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-700">
            <span>
              {config.label}[<span className="font-mono">{selected.id}</span>]の直接入力の明細
            </span>
            <button type="button" onClick={() => setSelected(null)} className="font-bold text-slate-700 hover:text-slate-900">
              ← {config.label}を選び直す
            </button>
          </div>
          {directLines.length === 0 ? (
            <p className="text-xs text-slate-600">
              この{config.label}には直接入力(品目マスタに無い)の明細がありません(品目マスタにある明細は{kind === "purchase" ? "入荷" : "出荷"}で扱います)。
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white text-xs">
              {directLines.map((line) => (
                <li key={line.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onPick({
                        orderId: selected.id,
                        itemId: line.id,
                        itemName: line.itemName ?? "",
                        quantity: line.quantity,
                        partnerId: selected.partnerId ?? null,
                      })
                    }
                    className="w-full px-2 py-1.5 text-left text-slate-800 hover:bg-indigo-50"
                  >
                    {line.itemName || "(品名なし)"} <span className="font-mono">× {line.quantity}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
