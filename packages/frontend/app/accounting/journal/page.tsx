"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useJournalPostingEvents } from "./_hooks/useJournalPostingEvents";
import { useJournalExport } from "./_hooks/useJournalExport";
import { JournalExportFilterForm } from "./_components/JournalExportFilterForm";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { DataTable } from "../../_shared/ui/DataTable";
import { StatusBadge } from "../../_shared/ui/StatusBadge";
import { getJournalPostingStatus } from "../../_shared/status/journal-posting-status";
import { JournalSourceSection } from "./_components/JournalSourceSection";
import { JournalBatchViewModal } from "./_components/JournalBatchViewModal";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  purchase_order: "発注",
  stock_receipt: "入荷実績",
  sales_order: "受注",
  stock_shipment: "出荷実績",
  sales_invoice: "売上",
  purchase_recognition: "仕入",
  payment_receipt: "入金消込",
  payment_disbursement: "支払消込",
  cash_receipt: "単体入金",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  PREPAYMENT: "前払",
  PURCHASE: "仕入計上",
  ADVANCE_RECEIPT: "前受",
  SALES: "売上計上",
  RECEIPT: "入金",
  DISBURSEMENT: "支払",
};

export default function JournalPostingEventsPage() {
  const { canRead, canUpdate, loading: permsLoading } = usePagePermissions();
  const {
    events,
    loading,
    retryingId,
    message,
    error,
    retry,
    reload: reloadEvents,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = useJournalPostingEvents(!permsLoading && canRead);

  const {
    filters: exportFilters,
    setFilters: setExportFilters,
    handleClear: handleExportClear,
    handleDownload: handleExportDownload,
    downloading: exportDownloading,
    error: exportError,
  } = useJournalExport();

  // 「仕訳を見る」で開いている仕訳バッチ
  const [viewBatchId, setViewBatchId] = useState<string | null>(null);

  if (permsLoading) return <LoadingGate />;
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="💵 仕訳データ出力"
        description="仕訳にしていない伝票を選んで仕訳を作成し、検索条件を指定して会計ソフトへ渡すCSVを出力できます。転記の状況確認・再転記・作成した仕訳(借方・貸方)の確認は下段の一覧で行います。"
      />

      <JournalSourceSection
        enabled={!permsLoading && canRead}
        canUpdate={canUpdate}
        onPosted={() => void reloadEvents()}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-800">
            📤 仕訳データCSV出力
          </h2>
          <Link
            href="/accounting/journal-export-format"
            className="text-xs text-indigo-600 hover:underline font-bold"
          >
            🧾 出力フォーマット設定
          </Link>
        </div>
        <JournalExportFilterForm
          filters={exportFilters}
          setFilters={setExportFilters}
          onClear={handleExportClear}
        />
        <MessageBanner error={exportError} />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleExportDownload()}
            disabled={exportDownloading}
            className={`text-xs px-4 py-2 rounded font-bold text-white shadow-sm transition-colors ${
              exportDownloading
                ? "bg-slate-300 text-slate-500 opacity-70 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
            }`}
          >
            {exportDownloading ? "出力中..." : "📥 CSVダウンロード"}
          </button>
        </div>
      </section>

      <div className="border-b pb-4 border-slate-200">
        <h2 className="text-sm font-black text-slate-800">
          🔁 転記状況・再転記
        </h2>
        <p className="text-xs text-slate-600 mt-1">
          仕訳ルールマスタの設定に基づいて作成された仕訳の状況を確認します。転記に失敗した行は
          「再転記」で再試行できます(自動での再試行は行いません)。
        </p>
      </div>

      <MessageBanner message={message} error={error} />

      {loading ? (
        <p className="text-xs text-slate-600">読み込み中...</p>
      ) : (
        <DataTable
          columns={[
            { key: "requestedAt", label: "起票日時", sortable: true },
            { key: "sourceType", label: "元伝票", sortable: true },
            { key: "eventType", label: "会計事象", sortable: true },
            { key: "status", label: "状態", sortable: true },
            { key: "errorMessage", label: "エラー内容", sortable: true },
            { key: "actions", label: "操作", align: "center" },
          ]}
          data={events}
          emptyMessage="該当するデータはありません"
          sortBy={sortBy}
          sortDirection={sortDirection}
          sortKeys={sortKeys}
          onSortChange={setSort}
          renderRow={(e) => (
            <tr key={e.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                {new Date(e.requestedAt).toLocaleString("ja-JP")}
              </td>
              <td className="px-4 py-3 text-xs text-slate-700">
                {SOURCE_TYPE_LABEL[e.sourceType] || e.sourceType}
                <span className="ml-1 font-mono text-slate-600">
                  {e.sourceRefId}
                </span>
              </td>
              <td className="px-4 py-3 text-xs font-semibold text-slate-700">
                {EVENT_TYPE_LABEL[e.eventType] || e.eventType}
              </td>
              <td className="px-4 py-3">
                <StatusBadge {...getJournalPostingStatus(e.status)} />
                {e.retryCount > 0 && (
                  <span className="ml-2 text-[10px] text-slate-600">
                    再試行{e.retryCount}回
                  </span>
                )}
              </td>
              <td
                className="px-4 py-3 text-xs text-red-600 max-w-[280px] truncate"
                title={e.errorMessage || ""}
              >
                {e.errorMessage || "-"}
              </td>
              <td className="px-4 py-3 text-center whitespace-nowrap">
                {e.status === "POSTED" && e.postedBatchId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setViewBatchId(e.postedBatchId)}
                  >
                    📒 仕訳を見る
                  </Button>
                )}
                {e.status === "FAILED" && (
                  <Button
                    size="sm"
                    onClick={() => void retry(e.id)}
                    disabled={!canUpdate || retryingId === e.id}
                  >
                    {retryingId === e.id ? "再転記中..." : "🔁 再転記"}
                  </Button>
                )}
              </td>
            </tr>
          )}
        />
      )}

      {viewBatchId && (
        <JournalBatchViewModal
          batchId={viewBatchId}
          onClose={() => setViewBatchId(null)}
        />
      )}
    </div>
  );
}
