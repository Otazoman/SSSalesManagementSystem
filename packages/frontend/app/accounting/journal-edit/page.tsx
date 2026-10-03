"use client";

import { Fragment, useMemo } from "react";

import { usePagePermissions } from "../../hooks/use-page-permission";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { DataTable } from "../../_shared/ui/DataTable";
import { Pagination } from "../../_shared/ui/Pagination";
import { useJournalBatches } from "./_hooks/useJournalBatches";
import { useJournalBatchActions } from "./_hooks/useJournalBatchActions";
import { JournalBatchSearchForm } from "./_components/JournalBatchSearchForm";
import { JournalBatchDetailModal } from "./_components/JournalBatchDetailModal";
import { JournalBatchType } from "./_types";
import { AccountLabel, pairNote } from "../_components/JournalPairTable";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  purchase_order: "発注",
  purchase_recognition: "仕入計上",
  sales_order: "受注",
  sales_invoice: "売上計上",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  PREPAYMENT: "前払",
  PURCHASE: "仕入計上",
  ADVANCE_RECEIPT: "前受",
  SALES: "売上計上",
  RECEIPT: "入金",
  DISBURSEMENT: "支払",
};

const TYPE_LABEL: Record<JournalBatchType, string> = {
  ORIGINAL: "元バッチ",
  REVERSAL: "反対仕訳",
  CORRECTION: "訂正仕訳",
};

const TYPE_CLASS: Record<JournalBatchType, string> = {
  ORIGINAL: "text-slate-700 bg-slate-100",
  REVERSAL: "text-red-700 bg-red-50",
  CORRECTION: "text-emerald-700 bg-emerald-50",
};

export default function JournalEditPage() {
  const { canRead, canUpdate, loading: permsLoading } = usePagePermissions();

  const {
    batches,
    loading,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    message,
    setMessage,
    error,
    setError,
    syncBatches,
  } = useJournalBatches();

  const {
    filters,
    setFilters,
    handleClearSearch,
    detail,
    detailLoading,
    handleOpenDetail,
    handleCloseDetail,
    accounts,
    isCorrecting,
    correctDescription,
    setCorrectDescription,
    correctMemo,
    setCorrectMemo,
    correctLines,
    handleStartCorrecting,
    handleCancelCorrecting,
    handleCorrectLineAccountChange,
    isSubmittingCorrection,
    handleSubmitCorrection,
  } = useJournalBatchActions({ syncBatches, setMessage, setError });

  // 科目名が保存されていない古い仕訳の表示用(勘定科目コード→科目名)
  const accountNames = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.code, a.name])),
    [accounts],
  );

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
        title="📝 仕訳編集"
        description="作成済みの仕訳を「借方〇〇/貸方〇〇」の組で一覧し、勘定科目・摘要・メモを訂正します。仕訳は直接書き換えず、反対仕訳+訂正仕訳を新規に起票する方式です。金額・消費税区分・税率は変更できません。"
      />

      <MessageBanner message={message} error={error} />

      <JournalBatchSearchForm
        filters={filters}
        setFilters={setFilters}
        onClear={handleClearSearch}
      />

      <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
        <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
          該当件数: <span className="font-black text-indigo-600">{total}</span>{" "}
          件
        </span>
      </div>

      {loading ? (
        <p className="text-xs text-slate-600">読み込み中...</p>
      ) : (
        <DataTable
          columns={[
            { key: "entryDate", label: "計上日", sortable: true },
            { key: "sourceType", label: "元伝票・会計事象" },
            { key: "type", label: "種別" },
            { key: "debitAccount", label: "借方科目" },
            {
              key: "totalDebitAmount",
              label: "借方金額",
              align: "right",
              sortable: true,
            },
            { key: "creditAccount", label: "貸方科目" },
            { key: "creditAmount", label: "貸方金額", align: "right" },
            { key: "note", label: "品目・税区分 / 摘要" },
            { key: "actions", label: "操作", align: "center" },
          ]}
          data={batches}
          emptyMessage="該当するデータはありません"
          sortBy={sortBy}
          sortDirection={sortDirection}
          sortKeys={sortKeys}
          onSortChange={setSort}
          renderRow={(b) => {
            // 1仕訳 = 「借方〇〇/貸方〇〇」の組の数だけ行を出し、仕訳単位の列は縦に結合する
            const pairs = b.pairs?.length ? b.pairs : [null];
            const span = pairs.length;
            return (
              <Fragment key={b.id}>
                {pairs.map((pair, i) => (
                  <tr
                    key={i}
                    className={`hover:bg-slate-50 transition-colors ${i === 0 ? "border-t-2 border-slate-200" : ""}`}
                  >
                    {i === 0 && (
                      <>
                        <td rowSpan={span} className="px-4 py-2 align-top text-xs text-slate-700 whitespace-nowrap">
                          {new Date(b.entryDate).toISOString().split("T")[0]}
                        </td>
                        <td rowSpan={span} className="px-4 py-2 align-top text-xs text-slate-700">
                          {SOURCE_TYPE_LABEL[b.sourceType] || b.sourceType}
                          <span className="ml-1 font-mono text-slate-600">{b.sourceRefId}</span>
                          <span className="block font-semibold text-slate-800">
                            {EVENT_TYPE_LABEL[b.eventType] || b.eventType}
                          </span>
                        </td>
                        <td rowSpan={span} className="px-4 py-2 align-top">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TYPE_CLASS[b.type]}`}>
                            {TYPE_LABEL[b.type]}
                          </span>
                        </td>
                      </>
                    )}
                    <td className="px-4 py-2 text-xs font-bold text-indigo-900">
                      {pair?.debit ? (
                        <AccountLabel line={pair.debit} names={accountNames} className="font-bold text-indigo-900" />
                      ) : (
                        <span className="font-normal text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-800 whitespace-nowrap">
                      {pair?.debit ? `¥${pair.amount.toLocaleString()}` : ""}
                    </td>
                    <td className="px-4 py-2 text-xs font-bold text-orange-900">
                      {pair?.credit ? (
                        <AccountLabel line={pair.credit} names={accountNames} className="font-bold text-orange-900" />
                      ) : (
                        <span className="font-normal text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-800 whitespace-nowrap">
                      {pair?.credit ? `¥${pair.amount.toLocaleString()}` : ""}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-700 max-w-[260px]">
                      {(pair && pairNote(pair)) || (i === 0 ? b.description : "")}
                    </td>
                    {i === 0 && (
                      <td rowSpan={span} className="px-4 py-2 align-top text-center whitespace-nowrap">
                        <Button size="sm" onClick={() => void handleOpenDetail(b.id)}>
                          詳細・訂正
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </Fragment>
            );
          }}
        />
      )}

      <Pagination
        paginationEnabled={paginationEnabled}
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={setLimit}
      />

      <JournalBatchDetailModal
        detail={detail}
        loading={detailLoading}
        canUpdate={canUpdate}
        accounts={accounts}
        isCorrecting={isCorrecting}
        correctDescription={correctDescription}
        setCorrectDescription={setCorrectDescription}
        correctMemo={correctMemo}
        setCorrectMemo={setCorrectMemo}
        correctLines={correctLines}
        onStartCorrecting={handleStartCorrecting}
        onCancelCorrecting={handleCancelCorrecting}
        onCorrectLineAccountChange={handleCorrectLineAccountChange}
        isSubmittingCorrection={isSubmittingCorrection}
        onSubmitCorrection={() => void handleSubmitCorrection()}
        onClose={handleCloseDetail}
      />
    </div>
  );
}
