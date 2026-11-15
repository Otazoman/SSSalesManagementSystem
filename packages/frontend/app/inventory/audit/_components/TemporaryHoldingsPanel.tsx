"use client";

import { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { DataTable } from "../../../_shared/ui/DataTable";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { todayJst } from "../../../_shared/jst-date";
import { useTemporaryHoldings } from "../_hooks/useTemporaryHoldings";
import { HOLDING_CATEGORY_LABELS, HOLDING_STATUS_LABELS, TemporaryHolding } from "../_types/temporary-holdings";
import { PurchaseOrderLineSource, TemporaryHoldingReceiveModal } from "./TemporaryHoldingReceiveModal";
import { SalesOrderLineTarget, TemporaryHoldingDetailModal } from "./TemporaryHoldingDetailModal";

// REQ-011(2): 在庫・棚卸管理の「一時保管」タブ。品目マスタに無い物(自社品・預り品)の台帳(在庫数・棚卸・在庫評価には含めない)
interface Props {
  canCreate: boolean;
  canDelete: boolean;
  /** 発注の直接入力の明細から開いた時(受入の画面を開いて引き継ぐ) */
  initialReceiveSource?: PurchaseOrderLineSource | null;
  /** 受注の直接入力の明細から開いた時(払い出す一時保管を選ぶと、その明細に紐づけて払い出す) */
  releaseTarget?: SalesOrderLineTarget | null;
}

const STATUS_TONE = { HOLDING: "sky", RELEASED: "slate", MOVED_TO_STOCK: "emerald" } as const;

export function TemporaryHoldingsPanel({ canCreate, canDelete, initialReceiveSource = null, releaseTarget = null }: Props) {
  const list = useTemporaryHoldings(true);
  const [message, setMessage] = useState("");
  const [showReceive, setShowReceive] = useState(!!initialReceiveSource);
  const [receiveSource, setReceiveSource] = useState<PurchaseOrderLineSource | null>(initialReceiveSource);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [csvError, setCsvError] = useState("");
  const { download } = useCsvDownload({ fileNamePrefix: "temporary_holdings_export", onError: setCsvError });
  const today = todayJst();

  const f = list.filters;
  const setFilter = (key: keyof typeof f, value: string) => list.setFilters({ ...f, [key]: value });

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-700">
        品目マスタに無い物(発注・受注の直接入力の明細、取引先からの預り品など)を、在庫とは別に管理します。在庫数・引当・棚卸・在庫評価・仕訳には含めません。
        承認フロー(対象申請種別「一時保管」)があれば、受入・払出・調整は承認されてから数量に入ります。
      </p>
      <MessageBanner message={message} error={list.error || csvError} />
      {releaseTarget && (
        <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-xs font-bold text-indigo-900">
          受注[{releaseTarget.salesOrderId}]の直接入力の明細に払い出す一時保管を、一覧の「詳細」から選んでください。
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <select aria-label="区分" className={`${formFieldInputClass} w-auto`} value={f.category} onChange={(e) => setFilter("category", e.target.value)}>
          <option value="all">区分: すべて</option>
          <option value="OWN">自社品</option>
          <option value="CUSTODY">預り品</option>
        </select>
        <select aria-label="状態" className={`${formFieldInputClass} w-auto`} value={f.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="all">状態: すべて</option>
          <option value="HOLDING">保管中</option>
          <option value="RELEASED">払出済</option>
          <option value="MOVED_TO_STOCK">在庫へ移行済</option>
        </select>
        <select aria-label="倉庫" className={`${formFieldInputClass} w-auto`} value={f.warehouseId} onChange={(e) => setFilter("warehouseId", e.target.value)}>
          <option value="">倉庫: すべて</option>
          {list.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <input
          aria-label="キーワード"
          className={`${formFieldInputClass} w-48`}
          placeholder="品名・番号・発注番号"
          value={f.keyword}
          onChange={(e) => setFilter("keyword", e.target.value)}
        />
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => void download(`/api/temporary-holdings/csv-download${list.query ? `?${list.query}` : ""}`)}>
            CSV出力
          </Button>
          {canCreate && (
            <Button
              variant="primary"
              onClick={() => {
                setReceiveSource(null);
                setShowReceive(true);
              }}
            >
              ＋ 受け入れる
            </Button>
          )}
        </div>
      </div>

      <DataTable<TemporaryHolding>
        minWidth={900}
        loading={list.loading}
        emptyMessage="一時保管はありません"
        data={list.holdings}
        columns={[
          { key: "id", label: "番号" },
          { key: "category", label: "区分" },
          { key: "itemName", label: "品名" },
          { key: "quantity", label: "数量", align: "right" },
          { key: "place", label: "保管場所" },
          { key: "source", label: "元の伝票" },
          { key: "partner", label: "取引先" },
          { key: "receivedDate", label: "受入日" },
          { key: "plannedReleaseDate", label: "払出予定日" },
          { key: "status", label: "状態" },
          { key: "actions", label: "操作" },
        ]}
        renderRow={(h) => {
          const overdue = h.status === "HOLDING" && !!h.plannedReleaseDate && h.plannedReleaseDate.slice(0, 10) < today;
          return (
            <tr key={h.id} className="border-b border-slate-100 text-xs text-slate-800">
              <td className="px-3 py-2 font-mono whitespace-nowrap">{h.id}</td>
              <td className="px-3 py-2 whitespace-nowrap">{HOLDING_CATEGORY_LABELS[h.category]}</td>
              <td className="px-3 py-2">
                {h.itemName}
                {h.spec && <span className="block text-slate-600">{h.spec}</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                {h.quantity} {h.unitName ?? ""}
                {!!h.pendingQuantity && (
                  <span className="block font-bold text-amber-800">
                    承認待ち {h.pendingQuantity > 0 ? `+${h.pendingQuantity}` : h.pendingQuantity}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {list.warehouseName(h.warehouseId)}
                {h.locationId ? ` / ${h.locationId}` : ""}
              </td>
              <td className="px-3 py-2 font-mono whitespace-nowrap">{h.sourceId ? `発注 ${h.sourceId}` : ""}</td>
              <td className="px-3 py-2">{list.partnerName(h.partnerId)}</td>
              <td className="px-3 py-2 font-mono whitespace-nowrap">{h.receivedDate.slice(0, 10)}</td>
              <td className={`px-3 py-2 font-mono whitespace-nowrap ${overdue ? "font-bold text-red-700" : ""}`}>
                {h.plannedReleaseDate ? h.plannedReleaseDate.slice(0, 10) : ""}
                {overdue && <span className="block">予定日を過ぎています</span>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <StatusBadge label={HOLDING_STATUS_LABELS[h.status]} tone={STATUS_TONE[h.status]} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Button variant="secondary" onClick={() => setOpenedId(h.id)}>
                  詳細
                </Button>
              </td>
            </tr>
          );
        }}
      />

      {showReceive && (
        <TemporaryHoldingReceiveModal
          warehouses={list.warehouses}
          partners={list.partners}
          source={receiveSource}
          onClose={() => setShowReceive(false)}
          onSaved={(msg) => {
            setMessage(msg);
            setShowReceive(false);
            list.reload();
          }}
        />
      )}
      {openedId && (
        <TemporaryHoldingDetailModal
          holdingId={openedId}
          canCreate={canCreate}
          canDelete={canDelete}
          releaseTarget={releaseTarget}
          warehouseName={list.warehouseName}
          partnerName={list.partnerName}
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
