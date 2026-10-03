"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useUnitApi } from "./_hooks/useUnitApi";
import { UnitForm } from "./_components/UnitForm";
import { UnitCsvImport } from "./_components/UnitCsvImport";
import { UnitTable } from "./_components/UnitTable";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";

export default function AdminUnitsPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isUnitWfEnabled,
    departments,
    loading: permsLoading,
  } = usePagePermissions();

  const [showForm, setShowForm] = useState(false);

  const {
    units,
    code,
    name,
    status,
    setStatus,
    isUnitCurrentlyLocked,
    editingUnit,
    message,
    error,
    isSubmitting,
    setCode,
    setName,
    filterStatus,
    setFilterStatus,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    handleDownloadCsv,
    handleImportCsv,
    handleSubmit,
    handleDelete,
    handleSuspend,
    handleStartEdit,
    handleCancelEdit,
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
  } = useUnitApi({
    canRead,
    canCreate,
    canUpdate,
    canDelete,
    permsLoading,
    isUnitWfEnabled,
    departments,
  });

  // 編集モード開始時に自動でフォームを開く
  const onSelectRow = (u: Parameters<typeof handleStartEdit>[0]) => {
    handleStartEdit(u);
    setShowForm(true);
  };

  // 💡 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  // (取引先マスタのpage.tsxと同じパターン。以前はこのURLパラメータ処理が単位マスタに無く、
  // 差戻し修正が常に取引先マスタへ誤って遷移していた不具合の一部として発見・追加)
  const searchParams = useSearchParams();
  const urlEditId = searchParams.get("editId");

  useEffect(() => {
    if (urlEditId && units.length > 0) {
      const target = units.find((u) => u.code === urlEditId);
      if (target) {
        onSelectRow(target);
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId, units]);

  const handleCloseForm = () => {
    handleCancelEdit();
    setShowForm(false);
  };

  const guard = useDiscardGuard(showForm);
  const requestCloseForm = async () => {
    if ((await guard.confirmDiscard())) handleCloseForm();
  };

  if (permsLoading) {
    return <LoadingGate />;
  }

  if (!canRead) {
    return <AccessDeniedInline />;
  }

  return (
    <div className="w-full space-y-6">
      {/* ヘッダー */}
      <PageHeader
        title="📐 単位マスタ"
        description={
          <>
            品目マスタで原材料や製品を管理するための基本単位(PCS, KG,
            BOXなど)を設定・管理します。
          </>
        }
        actions={
          <>
            <Button
              variant="success"
              size="sm"
              className="border disabled:border-slate-300"
              onClick={handleDownloadCsv}
              disabled={!canRead || isSubmitting}
            >
              📥 CSVダウンロード
            </Button>
          </>
        }
      />

      {/* メッセージ・エラー表示 */}
      <MessageBanner message={message} error={error} />

      {/* サブバー(取引先マスタに準拠) */}
      <div className="flex flex-wrap justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <div className="min-w-96 shrink-0">
          <StatusTabs
            options={[
              { value: "active", label: "🟢 有効" },
              { value: "temporary", label: "🟡 仮登録" },
              { value: "suspended", label: "🔴 無効" },
              { value: "all", label: "🌐 すべて" },
            ]}
            value={filterStatus}
            onChange={setFilterStatus}
          />
        </div>
        <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full shrink-0">
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

      {/* 登録・編集フォーム & CSVインポート(取引先マスタスタイルの2列グリッド) */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <UnitForm
            code={code}
            name={name}
            status={status}
            editingUnit={editingUnit}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isSubmitting={isSubmitting}
            isUnitWfEnabled={isUnitWfEnabled}
            isUnitCurrentlyLocked={isUnitCurrentlyLocked}
            departments={departments}
            applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
            setApplicantDepartmentSurrogateId={
              setApplicantDepartmentSurrogateId
            }
            setCode={setCode}
            setName={setName}
            setStatus={setStatus}
            onSubmit={(e) => {
              handleSubmit(e);
            }}
            onCancel={requestCloseForm}
          />
          <UnitCsvImport
            canCreate={canCreate}
            editingUnit={editingUnit}
            isSubmitting={isSubmitting}
            isUnitWfEnabled={isUnitWfEnabled}
            onImportCsv={handleImportCsv}
          />
        </div>
      )}

      {/* データ一覧テーブル(全幅表示) */}
      <UnitTable
        units={units}
        editingUnit={editingUnit}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSubmitting={isSubmitting}
        onStartEdit={onSelectRow}
        onDelete={handleDelete}
        onSuspend={handleSuspend}
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
