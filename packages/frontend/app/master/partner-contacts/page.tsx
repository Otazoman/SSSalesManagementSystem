"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useContactManagement } from "./_hooks/useContactManagement";
import { SearchPanel } from "./_components/SearchPanel";
import { ContactForm } from "./_components/ContactForm";
import { ContactTable } from "./_components/ContactTable";
import { ContactRecord } from "./_types";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";

export default function AdminPartnerContactsPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isPartnerContactWfEnabled,
    departments,
    loading,
  } = usePagePermissions();

  const {
    contacts,
    partners,
    users,
    searchPartnerId,
    setSearchPartnerId,
    searchName,
    setSearchName,
    filterStatus,
    setFilterStatus,
    message,
    setMessage,
    error,
    setError,
    syncContacts,
    handleDownloadCsv,
    handleImportCsv,
    handleDeleteContact,
    handleSuspendContact,
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
  } = useContactManagement({
    canRead,
    canCreate,
    loading,
    isPartnerContactWfEnabled,
    departments,
  });

  // フォームの開閉、および編集データ管理
  const [showForm, setShowForm] = useState(false);
  const guard = useDiscardGuard(showForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<ContactRecord | null>(
    null,
  );

  // フォームへの編集データ自動セット用ハンドラー
  const handleEditInit = (contact: ContactRecord) => {
    setEditingId(contact.id);
    setEditingRecord(contact);
    setShowForm(true);
  };

  // 💡 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  // (early returnより前に置く必要がある。Reactのフックはコンポーネントの早期returnの前で
  // 呼び出し順序が常に一定でなければならないため)
  const searchParams = useSearchParams();
  const urlEditId = searchParams.get("editId");

  useEffect(() => {
    if (urlEditId && contacts.length > 0) {
      const target = contacts.find((c) => c.id === urlEditId);
      if (target) {
        handleEditInit(target);
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
  }, [urlEditId, contacts]);

  // 💡 1. ローディング中の表示制御
  if (loading) {
    return <LoadingGate />;
  }

  // 💡 2. 閲覧権限（Read）がない場合の画面ブロック
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  // CSVダウンロードができる条件
  const isCsvExportable = canRead && canCreate;
  // フォームの編集権限判定
  const hasFormPermission = editingId ? canUpdate : canCreate;

  return (
    <div className="w-full space-y-6">
      {/* 画面ヘッダー */}
      <PageHeader
        title="📇 取引先担当者マスタ"
        description="取引先ごとの自社窓口および相手方担当者を一元管理します。"
        actions={
          <>
            <button
              onClick={handleDownloadCsv}
              disabled={!isCsvExportable}
              className={`text-xs border px-3 py-1.5 rounded font-bold shadow-sm transition-colors ${
                isCsvExportable
                  ? "bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                  : "bg-slate-200 text-slate-500 opacity-70 border-slate-300 cursor-not-allowed shadow-none"
              }`}
            >
              📥 CSVダウンロード
            </button>
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      {/* 検索パネル */}
      <SearchPanel
        searchPartnerId={searchPartnerId}
        setSearchPartnerId={setSearchPartnerId}
        searchName={searchName}
        setSearchName={setSearchName}
        partners={partners}
      />

      <div className="flex flex-wrap justify-between items-center p-2 bg-slate-50 border rounded-lg gap-4">
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
        <Button
          size="sm"
          onClick={async () => {
            if (showForm && !(await guard.confirmDiscard())) return;
            setShowForm(!showForm);
            setEditingId(null);
            setEditingRecord(null);
          }}
        >
          {showForm ? "キャンセル" : "➕ 新規個別登録・CSVインポート"}
        </Button>
      </div>

      {/* フォームエリア */}
      {showForm && (
        <div className="contents" {...guard.scopeProps}>
          <ContactForm
            editingId={editingId}
            setEditingId={setEditingId}
            initialValues={editingRecord}
            partners={partners}
            users={users}
            hasFormPermission={hasFormPermission}
            canCreate={canCreate}
            isPartnerContactWfEnabled={isPartnerContactWfEnabled}
            departments={departments}
            onSuccess={setMessage}
            onError={setError}
            onSync={syncContacts}
            onImportCsv={handleImportCsv}
            onCloseForm={() => setShowForm(false)}
          />
        </div>
      )}

      {/* データ一覧テーブル */}
      <ContactTable
        contacts={contacts}
        partners={partners}
        users={users}
        canUpdate={canUpdate}
        canDelete={canDelete}
        onEditClick={handleEditInit}
        onDeleteClick={handleDeleteContact}
        onSuspendClick={handleSuspendContact}
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
