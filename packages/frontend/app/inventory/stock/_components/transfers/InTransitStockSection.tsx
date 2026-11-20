"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../../_shared/hooks/use-api-fetch";
import { InTransitRow } from "../../_types/stock-transfers";
import { TableScroll } from "../../../../_shared/ui/TableScroll";

// REQ-006: 在庫照会に出す「輸送中の在庫」(倉庫間移動で出庫済み・まだ入庫していない数量)。どちらの倉庫の在庫数にも含めていない
interface Props {
  enabled: boolean;
  warehouseName: (id: string) => string;
  productName: (id: string) => string;
}

export function InTransitStockSection({
  enabled,
  warehouseName,
  productName,
}: Props) {
  const [rows, setRows] = useState<InTransitRow[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch<InTransitRow[]>("/api/stock-transfers/in-transit")
      .then((r) => {
        if (!cancelled) setRows(Array.isArray(r) ? r : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (rows.length === 0) return null;
  return (
    <div className="border border-sky-200 rounded-lg">
      <div className="bg-sky-50 px-3 py-2 text-xs font-bold text-sky-900 border-b border-sky-200">
        🚚 輸送中の在庫(倉庫間移動。上の在庫数には含めていません)
      </div>
      <TableScroll minWidth={560}>
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-2">移動番号</th>
              <th className="px-3 py-2">品目</th>
              <th className="px-3 py-2">移動元 → 移動先</th>
              <th className="px-3 py-2">出庫日</th>
              <th className="px-3 py-2 text-right">輸送中</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {rows.map((r, idx) => (
              <tr key={`${r.transferId}-${r.itemId}-${idx}`}>
                <td className="px-3 py-2 font-mono">{r.transferId}</td>
                <td className="px-3 py-2">
                  {productName(r.itemId)}
                  {r.lotNumber !== "NONE" && (
                    <span className="text-slate-600">
                      (ロット {r.lotNumber})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {warehouseName(r.sourceWarehouseId)} →{" "}
                  {warehouseName(r.destinationWarehouseId)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {r.shippedDate.slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-bold">
                  {r.quantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
