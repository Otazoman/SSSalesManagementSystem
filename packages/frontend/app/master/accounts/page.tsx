"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useAccounts } from "./_hooks/useAccounts";
import { SearchPanel } from "./_components/SearchPanel";
import { AccountForm } from "./_components/AccountForm";
import { AccountCsvImport } from "./_components/AccountCsvImport";
import { AccountTable } from "./_components/AccountTable";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";

export default function AdminAccountsPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isAccountWfEnabled,
    departments,
    loading,
  } = usePagePermissions();

  const [showForm, setShowForm] = useState(false);

  const {
    accounts,
    editingAccount,
    setEditingAccount,
    isAccountCurrentlyLocked,
    searchCode,
    setSearchCode,
    searchName,
    setSearchName,
    searchStatus,
    setSearchStatus,
    message,
    error,
    isSubmitting,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    handleClearSearch,
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
  } = useAccounts({
    canRead,
    canCreate,
    canUpdate,
    canDelete,
    isAccountWfEnabled,
    departments,
    loading,
  });

  const onSelectAccount = (
    account: Parameters<typeof setEditingAccount>[0],
  ) => {
    setEditingAccount(account);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setEditingAccount(null);
    setShowForm(false);
  };

  const guard = useDiscardGuard(showForm);
  const requestCloseForm = async () => {
    if ((await guard.confirmDiscard())) handleCloseForm();
  };

  // 💡 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  // (以前は単位マスタ等に無く、差戻し修正が正しく該当レコードを開けない不具合があった。
  // 勘定科目マスタにも同じ処理が抜けていたため追加)
  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");

  useEffect(() => {
    if (urlEditId && accounts.length > 0) {
      const target = accounts.find((a) => a.code === urlEditId);
      if (target) {
        onSelectAccount(target);
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId, accounts]);

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
      {/* ヘッダーエリア */}
      <PageHeader
        title="📖 勘定科目マスタ"
        description="財務仕訳の基礎となる自動仕訳用のアカウントコード、および外部会計ソフト連携用マッピングを統制します。"
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

      {/* 通知メッセージ */}
      <MessageBanner message={message} error={error} />

      {/* 🔍 検索パネル */}
      <SearchPanel
        searchCode={searchCode}
        setSearchCode={setSearchCode}
        searchName={searchName}
        setSearchName={setSearchName}
        onClear={handleClearSearch}
      />

      {/* 🟢🟡🔴🌐 取引先マスタと揃えたサブバー(ステータスタブ ＋ 該当件数 ＋ ボタン) */}
      <div className="flex flex-wrap justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <div className="min-w-72 shrink-0">
          <StatusTabs
            options={[
              { value: "active", label: "🟢 有効" },
              { value: "temporary", label: "🟡 仮登録" },
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
          <AccountForm
            editingAccount={editingAccount}
            onCancelEdit={requestCloseForm}
            onSubmit={handleSubmit}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isAccountWfEnabled={isAccountWfEnabled}
            isLocked={isAccountCurrentlyLocked}
            isSubmitting={isSubmitting}
            departments={departments}
            applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
            setApplicantDepartmentSurrogateId={
              setApplicantDepartmentSurrogateId
            }
          />
          <AccountCsvImport
            canCreate={canCreate}
            editingAccount={editingAccount}
            isAccountWfEnabled={isAccountWfEnabled}
            isSubmitting={isSubmitting}
            onImportCsv={handleImportCsv}
          />
        </div>
      )}

      {/* 📋 データ一覧テーブル */}
      <AccountTable
        accounts={accounts}
        onSelectAccount={onSelectAccount}
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
