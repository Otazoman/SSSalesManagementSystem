"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useBomOperations } from "./_hooks/useBomOperations";
import { BomSearchFilter } from "./_components/BomSearchFilter";
import { BomTreeViewer } from "./_components/BomTreeViewer";
import { BomForm } from "./_components/BomForm";
import { BomCsvPanel } from "./_components/BomCsvPanel";
import { BomTable } from "./_components/BomTable";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";

export default function AdminProductStructuresPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isItemStructureWfEnabled,
    departments,
    loading: permissionLoading,
  } = usePagePermissions();

  const {
    structures,
    allItems,
    bomParents,
    displayedStructures,
    bomTree,
    totalTreeBomCost,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
    isSubmitting,
    showForm,
    setShowForm,
    editingId,
    isStructureCurrentlyLocked,
    parentItemId,
    setParentItemId,
    childItemId,
    setChildItemId,
    quantityRequired,
    setQuantityRequired,
    revision,
    setRevision,
    validFrom,
    setValidFrom,
    validTo,
    setValidTo,
    memo,
    setMemo,
    status,
    setStatus,
    searchParentId,
    setSearchParentId,
    searchChildId,
    setSearchChildId,
    filterStatus,
    setFilterStatus,
    treeTargetParentId,
    setTreeTargetParentId,
    treeTargetRevision,
    setTreeTargetRevision,
    filterPeriod,
    setFilterPeriod,
    message,
    error,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    canCsvAction,
    handleClearSearch,
    handleClearForm,
    handleSelectEdit,
    handleSubmit,
    handleDeleteLink,
    handleSuspend,
    handleDownloadCsv,
    handleImportCsv,
  } = useBomOperations({
    canRead,
    canCreate,
    canUpdate,
    canDelete,
    isItemStructureWfEnabled,
    departments,
  });

  const guard = useDiscardGuard(showForm);

  // 💡 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");

  useEffect(() => {
    if (urlEditId && structures.length > 0) {
      const target = structures.find((s) => s.id === urlEditId);
      if (target) {
        handleSelectEdit(target);
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId, structures]);

  if (permissionLoading) {
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

  return (
    <div className="w-full space-y-6">
      {/* 画面ヘッダー */}
      <PageHeader
        title="🛠️ 品目構成マスタ"
        description="製品・アセンブリの階層構成レシピ、員数、および原価の積算ロールアップを統合管理します。"
        actions={
          <>
            <button
              onClick={handleDownloadCsv}
              disabled={!canCsvAction || isSubmitting}
              className={`text-xs border px-3 py-1.5 rounded font-bold text-white transition-colors shadow-sm ${
                canCsvAction && !isSubmitting
                  ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
                  : "bg-slate-300 text-slate-500 border-slate-300 cursor-not-allowed"
              }`}
            >
              📥 CSVダウンロード
            </button>
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      {/* 🔎 検索・条件切り替えパネル */}
      <BomSearchFilter
        searchParentId={searchParentId}
        setSearchParentId={setSearchParentId}
        searchChildId={searchChildId}
        setSearchChildId={setSearchChildId}
        onClearSearch={handleClearSearch}
      />

      {/* 💡 サブバー(取引先マスタと完全同一のボタン・バッジレイアウト) */}
      <div className="flex flex-col gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-700 w-16 shrink-0">
            統制状態
          </span>
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
        </div>

        <div className="flex justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-700 w-16 shrink-0">
              適用期間
            </span>
            <div className="min-w-96 shrink-0">
              <StatusTabs
                options={[
                  { value: "current", label: "🟢 現行有効" },
                  { value: "expired", label: "🔴 期限切れ" },
                  { value: "future", label: "🟡 将来適用" },
                  { value: "all", label: "🌐 すべて" },
                ]}
                value={filterPeriod}
                onChange={(v) => setFilterPeriod(v as any)}
              />
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
              📊 該当件数:{" "}
              <span className="text-sm font-black text-indigo-600">
                {displayedStructures.length}
              </span>{" "}
              件
            </span>

            <button
              onClick={async () => {
                if (showForm) {
                  if (!(await guard.confirmDiscard())) return;
                  handleClearForm();
                }
                setShowForm(!showForm);
              }}
              disabled={!canCreate && !canUpdate && !showForm}
              className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${
                canCreate || canUpdate || showForm
                  ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                  : "bg-slate-300 text-slate-500 cursor-not-allowed"
              }`}
            >
              {showForm ? "キャンセル" : "➕ 新規個別登録・CSVインポート"}
            </button>
          </div>
        </div>
      </div>

      {/* 登録・一括管理フォーム＆ツリー構造ビューア領域 (showForm が true の時のみ一緒に展開) */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="space-y-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BomForm
              editingId={editingId}
              parentItemId={parentItemId}
              setParentItemId={setParentItemId}
              childItemId={childItemId}
              setChildItemId={setChildItemId}
              quantityRequired={quantityRequired}
              setQuantityRequired={setQuantityRequired}
              revision={revision}
              setRevision={setRevision}
              validFrom={validFrom}
              setValidFrom={setValidFrom}
              validTo={validTo}
              setValidTo={setValidTo}
              memo={memo}
              setMemo={setMemo}
              status={status}
              setStatus={setStatus}
              allItems={allItems}
              canCreate={canCreate}
              canUpdate={canUpdate}
              isSubmitting={isSubmitting}
              isItemStructureWfEnabled={isItemStructureWfEnabled}
              isStructureCurrentlyLocked={isStructureCurrentlyLocked}
              departments={departments}
              applicantDepartmentSurrogateId={applicantDepartmentSurrogateId}
              setApplicantDepartmentSurrogateId={
                setApplicantDepartmentSurrogateId
              }
              onSubmit={handleSubmit}
              onCancel={async () => {
                if (!(await guard.confirmDiscard())) return;
                handleClearForm();
                setShowForm(false);
              }}
            />

            <BomCsvPanel
              canCsvAction={canCsvAction}
              editingId={editingId}
              isSubmitting={isSubmitting}
              isItemStructureWfEnabled={isItemStructureWfEnabled}
              onImportCsv={handleImportCsv}
            />
          </div>

          {/* 🌴 ツリー構造ビューア(フォームと一緒に展開されるように内包化) */}
          <BomTreeViewer
            treeTargetParentId={treeTargetParentId}
            setTreeTargetParentId={setTreeTargetParentId}
            treeTargetRevision={treeTargetRevision}
            setTreeTargetRevision={setTreeTargetRevision}
            bomParents={bomParents}
            structures={structures}
            bomTree={bomTree}
            totalTreeBomCost={totalTreeBomCost}
          />
        </div>
      )}
      {/* フラットデータ一覧テーブルリスト */}
      <BomTable
        displayedStructures={displayedStructures}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSubmitting={isSubmitting}
        onSelectEdit={handleSelectEdit}
        onDeleteLink={handleDeleteLink}
        onSuspend={handleSuspend}
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortKeys={sortKeys}
        onSortChange={setSort}
      />
    </div>
  );
}
