"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useProjects } from "./_hooks/useProjects";
import { ProjectForm } from "./_components/ProjectForm";
import { ProjectCsvImport } from "./_components/ProjectCsvImport";
import { ProjectTable } from "./_components/ProjectTable";
import { ProjectRecord } from "./_types";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";

export default function MasterProjectsPage() {
  const { canCreate, canRead, canUpdate, canDelete, loading } =
    usePagePermissions();

  const [showForm, setShowForm] = useState(false);

  const {
    projects,
    editingProject,
    setEditingProject,
    searchStatus,
    setSearchStatus,
    message,
    error,
    isSubmitting,
    handleSubmit,
    handleDownloadCsv,
    handleImportCsv,
    handleDelete,
    handleSuspend,
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
  } = useProjects({ canRead, canCreate, canUpdate, canDelete, loading });

  const onSelectProject = (project: ProjectRecord) => {
    setEditingProject(project);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setEditingProject(null);
    setShowForm(false);
  };

  const guard = useDiscardGuard(showForm);
  const requestCloseForm = async () => {
    if ((await guard.confirmDiscard())) handleCloseForm();
  };

  if (loading) {
    return <LoadingGate />;
  }

  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  const isCsvExportable = canCreate || canUpdate;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="🗂️ プロジェクトマスタ"
        description="購買申請・発注の紐付け先となるプロジェクトを登録・管理する画面です。"
        actions={
          <>
            <button
              onClick={handleDownloadCsv}
              disabled={!isCsvExportable || isSubmitting}
              className={`text-xs border px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${
                isCsvExportable && !isSubmitting
                  ? "bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                  : "bg-slate-300 text-slate-500 border-slate-300 cursor-not-allowed shadow-none"
              }`}
            >
              📥 CSVダウンロード
            </button>
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      {/* サブバー */}
      <div className="flex flex-wrap justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <div className="min-w-72 shrink-0">
          <StatusTabs
            options={[
              { value: "active", label: "🟢 有効" },
              { value: "suspended", label: "🔴 無効" },
              { value: "", label: "🌐 すべて" },
            ]}
            value={searchStatus}
            onChange={setSearchStatus}
          />
        </div>

        <div className="flex items-center space-x-4">
          <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
            📊 該当件数:{" "}
            <span className="text-sm font-black text-indigo-600">{total}</span>{" "}
            件
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
      </div>

      {/* 登録・編集フォーム & CSVインポート */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <ProjectForm
            editingProject={editingProject}
            onCancelEdit={requestCloseForm}
            onSubmit={handleSubmit}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isSubmitting={isSubmitting}
          />
          <ProjectCsvImport
            canCreate={canCreate}
            editingProject={editingProject}
            isSubmitting={isSubmitting}
            onImportCsv={handleImportCsv}
          />
        </div>
      )}

      {/* データ一覧テーブル */}
      <ProjectTable
        projects={projects}
        onSelectProject={onSelectProject}
        onDelete={handleDelete}
        onSuspend={handleSuspend}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSubmitting={isSubmitting}
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
