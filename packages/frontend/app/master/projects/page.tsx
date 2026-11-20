"use client";

import { useEffect, useState } from "react";
import { MasterFormModal } from "../../_shared/ui/MasterFormModal";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
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
  const { canCreate, canRead, canUpdate, canDelete, loading, isProjectWfEnabled, departments = [] } =
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
    isProjectCurrentlyLocked,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
  } = useProjects({ canRead, canCreate, canUpdate, canDelete, loading, isProjectWfEnabled, departments });

  const onSelectProject = (project: ProjectRecord) => {
    setEditingProject(project);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setEditingProject(null);
    setShowForm(false);
  };

  // BUG-097: 承認履歴の「修正して再申請」・承認のプレビューの「伝票を開く」(?editId=xxx)で、そのプロジェクトの編集フォームを開く。
  // 一覧は状態で絞り込まれているため、状態を問わずコードで探す
  const searchParams = useSearchParams();
  const urlEditId = searchParams?.get("editId") ?? null;
  useEffect(() => {
    if (!urlEditId || loading || !canRead) return;
    void (async () => {
      try {
        const found = await apiFetch<ProjectRecord[] | { data: ProjectRecord[] }>(
          `/api/projects?${new URLSearchParams({ id: urlEditId, status: "all" }).toString()}`,
        );
        const list = Array.isArray(found) ? found : found.data || [];
        const target = list.find((p) => p.id === urlEditId);
        if (target) {
          setEditingProject(target);
          setShowForm(true);
        }
      } catch (err) {
        console.error("プロジェクトの取得に失敗しました", err);
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId, loading, canRead]);


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
              // BUG-097: 承認 ON の時の仮登録(承認待ち・差戻し)
              ...(isProjectWfEnabled ? [{ value: "temporary", label: "🟡 仮登録" }] : []),
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
            onClick={() => setShowForm(true)}
            disabled={!canCreate}
            className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${
              canCreate
                ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                : "bg-slate-300 text-slate-500 cursor-not-allowed"
            }`}
          >
            ➕ 新規個別登録・CSVインポート
          </button>
        </div>
      </div>

      {/* 登録・編集フォーム & CSVインポート */}
      {/* REQ-024: 登録・編集の入力欄はモーダルで開く(一覧はモーダルの後ろに残る) */}
      {showForm && (
        <MasterFormModal
          title={editingProject ? "プロジェクトの編集" : "プロジェクトの新規登録・CSVインポート"}
          onClose={handleCloseForm}
          error={error}
          message={message}
        >
          {(requestClose) => (
            <>
          <ProjectForm
            editingProject={editingProject}
            onCancelEdit={() => void requestClose()}
            onSubmit={handleSubmit}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isSubmitting={isSubmitting}
            isProjectWfEnabled={isProjectWfEnabled}
            isProjectCurrentlyLocked={isProjectCurrentlyLocked}
            departments={departments}
            applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
            setApplicantDepartmentSurrogateId={setApplicantDepartmentSurrogateId}
          />
          <ProjectCsvImport
            canCreate={canCreate}
            editingProject={editingProject}
            isSubmitting={isSubmitting}
            onImportCsv={handleImportCsv}
            isProjectWfEnabled={isProjectWfEnabled}
          />
        </>
          )}
        </MasterFormModal>
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
