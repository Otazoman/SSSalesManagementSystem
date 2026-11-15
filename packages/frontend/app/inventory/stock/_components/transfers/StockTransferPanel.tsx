"use client";

import { useState } from "react";
import { Button } from "../../../../_shared/ui/Button";
import { MessageBanner } from "../../../../_shared/ui/MessageBanner";
import { DataTable } from "../../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../../_shared/ui/StatusBadge";
import { formFieldInputClass } from "../../../../_shared/ui/FormField";
import { useStockTransfers } from "../../_hooks/useStockTransfers";
import {
  StockTransfer,
  TRANSFER_STATUS_LABELS,
  TRANSFER_STATUS_TONES,
  remainingOf,
} from "../../_types/stock-transfers";
import { CreateStockTransferModal } from "./CreateStockTransferModal";
import { StockTransferDetailModal } from "./StockTransferDetailModal";

// REQ-006: 倉庫間移動の一覧(出荷の画面: 移動を作る / 入荷の画面: 輸送中の物を入庫する・差異で完了する)
interface Props {
  mode: "ship" | "receive";
  canCreate: boolean;
}

export function StockTransferPanel({ mode, canCreate }: Props) {
  const list = useStockTransfers(true);
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-700">
        {mode === "ship"
          ? "倉庫から別の倉庫へ在庫を移します。出庫すると「輸送中」になり、移動元・移動先どちらの在庫数にも入りません。移動先では入荷の画面の「倉庫間移動」から入庫します。"
          : "他の倉庫から送られた「輸送中」の在庫を入庫します。何回かに分けて入庫でき、届かない分は「差異で完了」で閉じます。"}
      </p>
      <MessageBanner message={message} error={list.error} />
      <div className="flex flex-wrap items-end gap-2">
        <select
          aria-label="状態"
          className={`${formFieldInputClass} w-auto`}
          value={list.status}
          onChange={(e) => list.setStatus(e.target.value)}
        >
          <option value="open">進行中(承認待ち・輸送中・一部入庫)</option>
          <option value="all">すべて</option>
          {Object.entries(TRANSFER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="倉庫"
          className={`${formFieldInputClass} w-auto`}
          value={list.warehouseId}
          onChange={(e) => list.setWarehouseId(e.target.value)}
        >
          <option value="">倉庫: すべて</option>
          {list.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {mode === "ship" && canCreate && (
          <div className="ml-auto">
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              ＋ 倉庫間移動を作る
            </Button>
          </div>
        )}
      </div>

      <DataTable<StockTransfer>
        minWidth={800}
        loading={list.loading}
        emptyMessage="倉庫間移動はありません"
        data={list.transfers}
        columns={[
          { key: "id", label: "移動番号" },
          { key: "shippedDate", label: "出庫日" },
          { key: "route", label: "移動元 → 移動先" },
          { key: "items", label: "品目" },
          { key: "inTransit", label: "輸送中", align: "right" },
          { key: "status", label: "状態" },
          { key: "actions", label: "操作" },
        ]}
        renderRow={(t) => {
          const inTransit = ["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(
            t.status,
          )
            ? t.items.reduce((sum, i) => sum + remainingOf(i), 0)
            : 0;
          return (
            <tr
              key={t.id}
              className="border-b border-slate-100 text-xs text-slate-800"
            >
              <td className="px-3 py-2 font-mono whitespace-nowrap">{t.id}</td>
              <td className="px-3 py-2 font-mono whitespace-nowrap">
                {t.shippedDate.slice(0, 10)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {list.warehouseName(t.sourceWarehouseId)} →{" "}
                {list.warehouseName(t.destinationWarehouseId)}
              </td>
              <td className="px-3 py-2">
                {t.items.map((i) => list.productName(i.itemId)).join("、")}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {inTransit || ""}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <StatusBadge
                  label={TRANSFER_STATUS_LABELS[t.status]}
                  tone={TRANSFER_STATUS_TONES[t.status]}
                />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Button variant="secondary" onClick={() => setOpenedId(t.id)}>
                  {mode === "receive" &&
                  ["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(t.status) &&
                  !t.receiptInstructionId
                    ? "入庫する"
                    : "詳細"}
                </Button>
              </td>
            </tr>
          );
        }}
      />

      {showCreate && (
        <CreateStockTransferModal
          warehouses={list.warehouses}
          products={list.products}
          onClose={() => setShowCreate(false)}
          onSaved={(msg) => {
            setMessage(msg);
            setShowCreate(false);
            list.reload();
          }}
        />
      )}
      {openedId && (
        <StockTransferDetailModal
          transferId={openedId}
          canReceive={mode === "receive" && canCreate}
          locations={list.locations}
          warehouseName={list.warehouseName}
          productName={list.productName}
          locationName={list.locationName}
          onClose={() => setOpenedId(null)}
          onChanged={(msg) => {
            setMessage(msg);
            list.reload();
          }}
        />
      )}
    </div>
  );
}
