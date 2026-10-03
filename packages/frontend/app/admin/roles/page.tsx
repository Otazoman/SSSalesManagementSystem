"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState } from "react";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useRoles } from "./_hooks/useRoles";
import { RoleHeader } from "./_components/RoleHeader";
import { RoleForm } from "./_components/RoleForm";
import { CsvImportPanel } from "./_components/CsvImportPanel";
import { RoleTable } from "./_components/RoleTable";
import { RoleRecord } from "./_types";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { Pagination } from "../../_shared/ui/Pagination";

export default function AdminRolesPage() {
  const { canRead, canCreate, canUpdate, canDelete, loading } =
    usePagePermissions();

  const [showForm, setShowForm] = useState(false);
  const guard = useDiscardGuard(showForm);

  const {
    roles,
    message,
    error,
    isSubmitting,
    editingId,
    setEditingId,
    setError,
    createRole,
    updateRole,
    deleteRole,
    downloadCsv,
    importCsv,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = useRoles(canRead, loading);

  if (loading) {
    return <LoadingGate label="ユーザー権限を確認中..." />;
  }

  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🛡️ アクセス拒否"
        description="この画面を閲覧する権限が付与されていません。"
      />
    );
  }

  const handleRowSelection = (role: RoleRecord) => {
    setEditingId(role.id);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const requestCloseForm = async () => {
    if ((await guard.confirmDiscard())) handleCloseForm();
  };

  return (
    <div className="w-full space-y-6">
      {/* 画面ヘッダー */}
      <RoleHeader
        canDownload={canRead}
        isSubmitting={isSubmitting}
        onDownloadCsv={downloadCsv}
      />

      {/* 通知・エラーメッセージ */}
      <MessageBanner message={message} error={error} />

      {/* サブバー */}
      <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
        <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
          📊 該当件数:{" "}
          <span className="text-sm font-black text-indigo-600">{total}</span> 件
        </span>

        <button
          onClick={() => (showForm ? requestCloseForm() : setShowForm(true))}
          disabled={!canCreate && !showForm}
          className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${
            canCreate || showForm
              ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          {showForm ? "キャンセル" : "➕ 新規個別登録・CSVインポート"}
        </button>
      </div>

      {/* 登録・編集フォーム & CSVインポート */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <RoleForm
            canCreate={canCreate}
            canUpdate={canUpdate}
            editingId={editingId}
            roles={roles}
            isSubmitting={isSubmitting}
            onCreate={createRole}
            onUpdate={updateRole}
            onClose={requestCloseForm}
            setError={setError}
          />
          <CsvImportPanel
            canCreate={canCreate}
            editingId={editingId}
            isSubmitting={isSubmitting}
            onImportCsv={importCsv}
          />
        </div>
      )}

      {/* データ一覧テーブル */}
      <RoleTable
        roles={roles}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSubmitting={isSubmitting}
        onSelectRow={handleRowSelection}
        onDelete={deleteRole}
        setError={setError}
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortKeys={sortKeys}
        onSortChange={setSort}
      />

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
