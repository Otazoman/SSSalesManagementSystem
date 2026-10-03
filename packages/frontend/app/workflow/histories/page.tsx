// app/XXX/page.tsx
"use client";

import React from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { usePagePermissions } from "../../hooks/use-page-permission"; // 環境に合わせて設定
import { usePermissionContext } from "../../context/permissioncontext";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";

// 最適化したモジュール・コンポーネントのインポート
import { WorkflowSearchForm } from "./_components/WorkflowSearchForm";
import { WorkflowTable } from "./_components/WorkflowTable";
import { useWorkflowHistory } from "./_hooks/useWorkflowHistory";
import { Pagination } from "../../_shared/ui/Pagination";
import { useWorkflowScreensAndUsers } from "../_shared/useWorkflowScreensAndUsers";

export default function WorkflowHistoryPage() {
  const { user } = usePermissionContext();
  const { canRead, loading: loadingPermissions } = usePagePermissions();

  // 🎣 カスタムフックに必要な権限・認証コンテキストを渡し一元管理
  const {
    histories,
    loadingData,
    isAdmin,
    filters,
    setFilters,
    counts,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    handleClearFilters,
    handleCancelRequest,
  } = useWorkflowHistory({
    userId: user?.id,
    canRead,
    loadingPermissions,
  });

  // 🔄 画面日本語マッピング・ユーザーマスタ・編集画面パス解決・承認候補者解決
  // (承認タスク画面と共通、workflow/_shared/useWorkflowScreensAndUsers.ts)
  const {
    userMaster,
    getTargetTypeJapanese,
    resolveTargetTypeEditPath,
    getEligibleApprovers,
  } = useWorkflowScreensAndUsers(!loadingPermissions && canRead);

  if (loadingPermissions) {
    return <LoadingGate />;
  }

  if (!canRead) {
    return <AccessDeniedInline />;
  }

  return (
    <div className="w-full space-y-6">
      {/* ヘッダー */}
      <PageHeader
        title={
          <>
            📜 申請履歴・進捗一覧
            {isAdmin && (
              <span className="ml-3 text-xs bg-indigo-600 text-white font-bold px-2 py-0.5 rounded-full align-middle">
                管理者モード
              </span>
            )}
          </>
        }
        description={
          isAdmin
            ? "システム全体のすべての決裁・処置履歴を監査・閲覧できます。"
            : "これまでにあなたが関与した、または申請したワークフローの決裁・処置履歴の一覧画面です。"
        }
      />

      {/* 🔍 検索フィルター */}
      <WorkflowSearchForm
        filters={filters}
        setFilters={setFilters}
        onClear={handleClearFilters}
        isAdmin={isAdmin}
        userMaster={userMaster}
      />

      {/* 📋 履歴一覧テーブル & プレビュー */}
      <div className="md:bg-white md:border md:border-slate-200 md:rounded-xl md:shadow-sm md:overflow-hidden">
        {/* ヘッダー・カウントエリア */}
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex flex-col sm:flex-row gap-2 sm:justify-between sm:items-center md:min-w-[950px] border rounded-lg mb-3 md:mb-0 md:rounded-none md:border-0 md:border-b">
          <span className="text-xs font-bold text-slate-700 flex items-center space-x-2">
            <span>
              📋 {isAdmin ? "システム全件・決裁履歴" : "あなたの決裁・処理履歴"}
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
            <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
              全体: <strong className="font-bold">{total}</strong> 件
            </span>
            <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-100">
              承認済み: <strong className="font-bold">{counts.approved}</strong>{" "}
              件
            </span>
            <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full border border-rose-100">
              差戻し: <strong className="font-bold">{counts.remanded}</strong>{" "}
              件
            </span>
            <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100">
              処理中: <strong className="font-bold">{counts.pending}</strong> 件
            </span>
            <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full border border-slate-200">
              取下げ: <strong className="font-bold">{counts.canceled}</strong> 件
            </span>
          </div>
        </div>

        {/* 最適化したメインテーブル */}
        <WorkflowTable
          histories={histories}
          // 💡【修正】マスタがロードし終わるまでテーブルの描画を安全に待たせます
          loadingData={loadingData || userMaster.length === 0}
          isAdmin={isAdmin}
          userId={user?.id}
          getTargetTypeJapanese={getTargetTypeJapanese}
          resolveTargetTypeEditPath={resolveTargetTypeEditPath}
          getEligibleApprovers={getEligibleApprovers}
          onCancelRequest={handleCancelRequest}
        />
      </div>

      <Pagination
        paginationEnabled={paginationEnabled}
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={setLimit}
      />
    </div>
  );
}
