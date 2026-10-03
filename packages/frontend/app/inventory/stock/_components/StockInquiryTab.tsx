"use client";

import { useState } from "react";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { Pagination } from "../../../_shared/ui/Pagination";
import { StatusPillTabs } from "../../../_shared/ui/StatusPillTabs";
import { StockSearchPanel } from "./StockSearchPanel";
import { StockTable } from "./StockTable";
import { useStockInquiry } from "../_hooks/useStockInquiry";
import { StockRecord } from "../_types";
import { ReclassifyModal, ReclassificationEditTarget } from "./ReclassifyModal";
import { ReturnModal, ReturnEditTarget } from "./ReturnModal";
import { DisposalModal, DisposalEditTarget } from "./DisposalModal";
import { StockReservationsModal } from "./StockReservationsModal";
import type { ApplicantDepartmentOption } from "../../../types";

interface StockInquiryTabProps {
  enabled: boolean;
  canCreate: boolean;
  isDamageWfEnabled: boolean;
  isReturnWfEnabled: boolean;
  isDisposalWfEnabled: boolean;
  departments?: ApplicantDepartmentOption[];
  // 画面構成再編(a): 承認履歴画面の「修正して再提出」からの遷移(?editId=)で、差戻し済みの
  // 品質区分変更・廃棄・返品を編集モードで開く。呼び出し元がタブ切替と同時に一度だけ渡す想定
  // (ReceiptInstructionPanel等のinitialEditTargetと同じ、条件付きマウント時の初期値パターン)
  initialReclassifyEditTarget?: ReclassificationEditTarget | null;
  initialDisposalEditTarget?: DisposalEditTarget | null;
  initialReturnEditTarget?: ReturnEditTarget | null;
  onEditConsumed?: () => void;
}

type ReclassifyModalState =
  | { mode: "create"; stock: StockRecord }
  | { mode: "edit"; target: ReclassificationEditTarget };

type DisposalModalState =
  | { mode: "create"; stock: StockRecord }
  | { mode: "edit"; target: DisposalEditTarget };

type ReturnModalState =
  | { mode: "create"; stock: StockRecord }
  | { mode: "edit"; target: ReturnEditTarget };

/**
 * Item6 Phase6-4フォローアップ: 在庫照会+品質区分変更・返品・廃棄アクション+在庫表CSVを1タブに
 * まとめたもの。/inventory/stockの「在庫照会」タブと同じ部品(StockSearchPanel/StockTable/
 * ReclassifyModal/ReturnModal/DisposalModal)を組み合わせる。
 */
export function StockInquiryTab({
  enabled,
  canCreate,
  isDamageWfEnabled,
  isReturnWfEnabled,
  isDisposalWfEnabled,
  departments,
  initialReclassifyEditTarget,
  initialDisposalEditTarget,
  initialReturnEditTarget,
  onEditConsumed,
}: StockInquiryTabProps) {
  const { paginationEnabled } = usePaginationSetting();
  const [message, setMessage] = useState("");
  const [reclassifyModal, setReclassifyModal] = useState<ReclassifyModalState | null>(
    initialReclassifyEditTarget ? { mode: "edit", target: initialReclassifyEditTarget } : null,
  );
  const [returnModal, setReturnModal] = useState<ReturnModalState | null>(
    initialReturnEditTarget ? { mode: "edit", target: initialReturnEditTarget } : null,
  );
  const [disposalModal, setDisposalModal] = useState<DisposalModalState | null>(
    initialDisposalEditTarget ? { mode: "edit", target: initialDisposalEditTarget } : null,
  );
  const [reservationsStock, setReservationsStock] = useState<StockRecord | null>(null);

  const inquiry = useStockInquiry(paginationEnabled, enabled);
  const { download: downloadStocksCsv } = useCsvDownload({
    fileNamePrefix: "stocks_export",
    onError: setMessage,
  });

  return (
    <div className="space-y-3">
      <MessageBanner message={message} error={inquiry.masterError} />
      <StockSearchPanel
        warehouses={inquiry.warehouses}
        locations={inquiry.locations}
        products={inquiry.products}
        warehouseId={inquiry.warehouseId}
        setWarehouseId={inquiry.setWarehouseId}
        locationId={inquiry.locationId}
        setLocationId={inquiry.setLocationId}
        itemId={inquiry.itemId}
        setItemId={inquiry.setItemId}
        onClear={inquiry.clearFilters}
      />
      <div className="flex flex-wrap justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <StatusPillTabs
          options={[
            { value: "", label: "🌐 すべて" },
            { value: "NORMAL", label: "🟢 良品" },
            { value: "DAMAGED", label: "🔴 破損品" },
            { value: "QUARANTINE", label: "🟡 検品待ち" },
          ]}
          value={inquiry.qualityStatus}
          onChange={inquiry.setQualityStatus}
        />
        <div className="flex items-center space-x-3 shrink-0">
          <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
            該当件数: <span className="font-black text-indigo-600">{inquiry.total}</span> 件
          </span>
          <button
            type="button"
            onClick={() => void inquiry.refetch()}
            className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
          >
            {inquiry.loading ? "更新中..." : "🔄 再読込"}
          </button>
          <button
            type="button"
            onClick={() => {
              const csvParams = new URLSearchParams();
              if (inquiry.warehouseId) csvParams.set("warehouseId", inquiry.warehouseId);
              if (inquiry.locationId) csvParams.set("locationId", inquiry.locationId);
              if (inquiry.itemId) csvParams.set("itemId", inquiry.itemId);
              if (inquiry.qualityStatus) csvParams.set("qualityStatus", inquiry.qualityStatus);
              const qs = csvParams.toString();
              void downloadStocksCsv(`/api/stocks/csv-download${qs ? `?${qs}` : ""}`);
            }}
            className="text-xs border border-slate-300 px-3 py-1.5 rounded font-bold text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
          >
            📊 在庫表CSV
          </button>
        </div>
      </div>
      <StockTable
        stocks={inquiry.stocks}
        loading={inquiry.loading}
        onReclassify={canCreate ? (s) => setReclassifyModal({ mode: "create", stock: s }) : undefined}
        onReturn={canCreate ? (s) => setReturnModal({ mode: "create", stock: s }) : undefined}
        onDispose={canCreate ? (s) => setDisposalModal({ mode: "create", stock: s }) : undefined}
        onViewReservations={(s) => setReservationsStock(s)}
        sortBy={inquiry.sortBy}
        sortDirection={inquiry.sortDirection}
        sortKeys={inquiry.sortKeys}
        onSortChange={inquiry.setSort}
      />
      <Pagination
        paginationEnabled={paginationEnabled}
        page={inquiry.page}
        totalPages={inquiry.totalPages}
        total={inquiry.total}
        limit={inquiry.limit}
        onPageChange={inquiry.setPage}
        onLimitChange={inquiry.setLimit}
      />

      {reclassifyModal && (
        <ReclassifyModal
          stock={reclassifyModal.mode === "create" ? reclassifyModal.stock : undefined}
          editTarget={reclassifyModal.mode === "edit" ? reclassifyModal.target : undefined}
          isDamageWfEnabled={isDamageWfEnabled}
          departments={departments}
          onClose={() => {
            setReclassifyModal(null);
            onEditConsumed?.();
          }}
          onSuccess={(msg) => {
            setMessage(msg);
            setReclassifyModal(null);
            onEditConsumed?.();
            void inquiry.refetch();
          }}
        />
      )}

      {returnModal && (
        <ReturnModal
          stock={returnModal.mode === "create" ? returnModal.stock : undefined}
          editTarget={returnModal.mode === "edit" ? returnModal.target : undefined}
          isReturnWfEnabled={isReturnWfEnabled}
          departments={departments}
          onClose={() => {
            setReturnModal(null);
            onEditConsumed?.();
          }}
          onSuccess={(msg) => {
            setMessage(msg);
            setReturnModal(null);
            onEditConsumed?.();
            void inquiry.refetch();
          }}
        />
      )}

      {reservationsStock && (
        <StockReservationsModal
          itemId={reservationsStock.itemId}
          itemName={reservationsStock.itemName}
          onClose={() => setReservationsStock(null)}
        />
      )}

      {disposalModal && (
        <DisposalModal
          stock={disposalModal.mode === "create" ? disposalModal.stock : undefined}
          editTarget={disposalModal.mode === "edit" ? disposalModal.target : undefined}
          isDisposalWfEnabled={isDisposalWfEnabled}
          departments={departments}
          onClose={() => {
            setDisposalModal(null);
            onEditConsumed?.();
          }}
          onSuccess={(msg) => {
            setMessage(msg);
            setDisposalModal(null);
            onEditConsumed?.();
            void inquiry.refetch();
          }}
        />
      )}
    </div>
  );
}
