"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../../../_shared/ui/Modal";
import { Button } from "../../../../_shared/ui/Button";
import {
  FormField,
  formFieldInputClass,
} from "../../../../_shared/ui/FormField";
import { MessageBanner } from "../../../../_shared/ui/MessageBanner";
import { apiFetch } from "../../../../_shared/hooks/use-api-fetch";
import { todayJst } from "../../../../_shared/jst-date";
import { ProductRecord, StockRecord, WarehouseRecord } from "../../_types";

// REQ-006: 倉庫間移動を作る。移動元が自社倉庫なら在庫(ロケーション・ロット)から選んで出庫し、外部倉庫なら品目と数量で出荷指示を作る
interface Props {
  warehouses: WarehouseRecord[];
  products: ProductRecord[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface Line {
  key: string;
  itemId: string;
  locationId: string | null;
  lotNumber: string | null;
  qualityStatus: string | null;
  available: number | null;
  quantity: string;
}

export function CreateStockTransferModal({
  warehouses,
  products,
  onClose,
  onSaved,
}: Props) {
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [shippedDate, setShippedDate] = useState(todayJst());
  const [memo, setMemo] = useState("");
  const [stocks, setStocks] = useState<StockRecord[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [externalItemId, setExternalItemId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const source = warehouses.find((w) => w.id === sourceWarehouseId);
  const sourceExternal = source?.warehouseType === "EXTERNAL";
  const destination = warehouses.find((w) => w.id === destinationWarehouseId);

  // 移動元が自社倉庫なら、その倉庫の在庫を出す(良品で数量があるもの)
  useEffect(() => {
    if (!sourceWarehouseId || sourceExternal) return;
    let cancelled = false;
    apiFetch<StockRecord[] | { data: StockRecord[] }>(
      `/api/stocks?warehouseId=${encodeURIComponent(sourceWarehouseId)}`,
    )
      .then((rows) => {
        if (!cancelled)
          setStocks(
            (Array.isArray(rows) ? rows : rows.data || []).filter(
              (s) => s.quantity > 0,
            ),
          );
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "在庫の取得に失敗しました",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [sourceWarehouseId, sourceExternal]);

  const changeSource = (id: string) => {
    setSourceWarehouseId(id);
    setLines([]);
    setStocks([]);
  };

  const addStockLine = (stock: StockRecord) => {
    if (lines.some((l) => l.key === stock.id)) return;
    setLines([
      ...lines,
      {
        key: stock.id,
        itemId: stock.itemId,
        locationId: stock.locationId,
        lotNumber: stock.lotNumber,
        qualityStatus: stock.qualityStatus,
        available: stock.quantity,
        quantity: String(stock.quantity),
      },
    ]);
  };

  const addExternalLine = () => {
    if (!externalItemId) return;
    setLines([
      ...lines,
      {
        key: `${externalItemId}-${lines.length}`,
        itemId: externalItemId,
        locationId: null,
        lotNumber: null,
        qualityStatus: null,
        available: null,
        quantity: "",
      },
    ]);
    setExternalItemId("");
  };

  const submit = async () => {
    setError("");
    setSaving(true);
    try {
      const data = await apiFetch<{ message?: string }>(
        "/api/stock-transfers/register",
        {
          method: "POST",
          json: {
            sourceWarehouseId,
            destinationWarehouseId,
            shippedDate,
            memo: memo || null,
            items: lines.map((l) => ({
              itemId: l.itemId,
              locationId: l.locationId,
              lotNumber: l.lotNumber,
              qualityStatus: l.qualityStatus,
              quantity: Number(l.quantity),
            })),
          },
          defaultErrorMessage: "倉庫間移動の作成に失敗しました",
        },
      );
      onSaved(data.message || "倉庫間移動を作りました");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "倉庫間移動の作成に失敗しました",
      );
    } finally {
      setSaving(false);
    }
  };

  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name ?? id;
  const valid =
    !!sourceWarehouseId &&
    !!destinationWarehouseId &&
    sourceWarehouseId !== destinationWarehouseId &&
    lines.length > 0 &&
    lines.every(
      (l) =>
        Number(l.quantity) > 0 &&
        (l.available === null || Number(l.quantity) <= l.available),
    );

  return (
    <Modal
      title="🔁 倉庫間移動を作る"
      size="2xl"
      onClose={onClose}
      warnOnDiscard
      footer={
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!valid || saving}
          >
            {sourceExternal ? "出荷指示を作る" : "出庫する"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        <MessageBanner error={error} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label="移動元の倉庫" required>
            <select
              aria-label="移動元の倉庫"
              className={formFieldInputClass}
              value={sourceWarehouseId}
              onChange={(e) => changeSource(e.target.value)}
            >
              <option value="">-- 選択 --</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}({w.warehouseType === "EXTERNAL" ? "外部" : "自社"})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="移動先の倉庫" required>
            <select
              aria-label="移動先の倉庫"
              className={formFieldInputClass}
              value={destinationWarehouseId}
              onChange={(e) => setDestinationWarehouseId(e.target.value)}
            >
              <option value="">-- 選択 --</option>
              {warehouses
                .filter((w) => w.id !== sourceWarehouseId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}({w.warehouseType === "EXTERNAL" ? "外部" : "自社"})
                  </option>
                ))}
            </select>
          </FormField>
          <FormField label="出庫日" required>
            <input
              type="date"
              className={formFieldInputClass}
              value={shippedDate}
              onChange={(e) => setShippedDate(e.target.value)}
            />
          </FormField>
        </div>
        {(sourceExternal || destination?.warehouseType === "EXTERNAL") && (
          <p className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-sky-900">
            {sourceExternal &&
              "移動元が外部倉庫のため、出荷指示を作ります(出荷の実績を取り込むと輸送中になります)。"}
            {destination?.warehouseType === "EXTERNAL" &&
              "移動先が外部倉庫のため、入荷指示を作ります(入荷の実績を取り込むと入庫済みになります)。"}
          </p>
        )}

        {sourceWarehouseId && !sourceExternal && (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 font-bold text-slate-700 border-b border-slate-200">
              移動元の在庫(押すと明細に足す)
            </div>
            <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100">
              {stocks.length === 0 && (
                <li className="px-3 py-2 text-slate-600">在庫がありません</li>
              )}
              {stocks.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => addStockLine(s)}
                    className="w-full flex justify-between px-3 py-2 text-left text-slate-800 bg-white hover:bg-indigo-50"
                  >
                    <span>
                      {s.itemName ?? s.itemId} /{" "}
                      {s.locationName ?? s.locationId}
                      {s.lotNumber !== "NONE" ? ` / ロット ${s.lotNumber}` : ""}
                      {s.qualityStatus !== "NORMAL"
                        ? ` / ${s.qualityStatus}`
                        : ""}
                    </span>
                    <span className="font-mono">{s.quantity}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {sourceExternal && (
          <div className="flex gap-2 items-end">
            <FormField label="品目">
              <select
                aria-label="品目"
                className={formFieldInputClass}
                value={externalItemId}
                onChange={(e) => setExternalItemId(e.target.value)}
              >
                <option value="">-- 選択 --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}({p.id})
                  </option>
                ))}
              </select>
            </FormField>
            <Button
              variant="secondary"
              onClick={addExternalLine}
              disabled={!externalItemId}
            >
              明細に足す
            </Button>
          </div>
        )}

        {lines.length > 0 && (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 font-bold text-slate-700 border-b border-slate-200">
              移動する明細
            </div>
            <ul className="divide-y divide-slate-100">
              {lines.map((l, idx) => (
                <li
                  key={l.key}
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                >
                  <span className="flex-1 text-slate-800">
                    {productName(l.itemId)}
                    {l.available !== null && (
                      <span className="text-slate-600">
                        (在庫 {l.available})
                      </span>
                    )}
                  </span>
                  <input
                    aria-label={`${productName(l.itemId)}の数量`}
                    type="number"
                    min={0}
                    step="any"
                    className={`${formFieldInputClass} w-28`}
                    value={l.quantity}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, i) =>
                          i === idx ? { ...x, quantity: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="secondary"
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                  >
                    外す
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <FormField label="メモ">
          <input
            className={formFieldInputClass}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </FormField>
      </div>
    </Modal>
  );
}
