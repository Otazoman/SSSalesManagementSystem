"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { usePriceOperations } from "./_hooks/usePriceOperations";
import { PriceForm } from "./_components/PriceForm";
import { SearchPanel } from "./_components/SearchPanel";
import { PriceTable } from "./_components/PriceTable";
import CsvImportPanel from "./_components/CsvImportPanel";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";

export default function AdminProductPricesPage() {
  const {
    canCreate,
    canUpdate,
    canDelete,
    canRead,
    isProductPriceWfEnabled,
    departments,
    loading: permsLoading,
  } = usePagePermissions();

  const [showForm, setShowForm] = useState(false);
  const guard = useDiscardGuard(showForm);
  const [filterStatus, setFilterStatus] = useState<string>(
    isProductPriceWfEnabled ? "temporary" : "active",
  );

  useEffect(() => {
    if (isProductPriceWfEnabled === true) {
      setFilterStatus("temporary");
    }
  }, [isProductPriceWfEnabled]);

  const handleSuccess = (msg: string) => {
    // 成功通知ハンドリング
  };

  const handleClose = () => {
    setShowForm(false);
  };

  const form = usePriceOperations({
    canCreate,
    canUpdate,
    canDelete,
    isProductPriceWfEnabled,
    departments,
    onSuccess: handleSuccess,
    onClose: handleClose,
  });

  const handleSelectPrice = (p: any) => {
    form.handleEditSelect(p);
    setShowForm(true);
  };

  // 💡 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  // (以前は単位マスタ等に無く、差戻し修正が正しく該当レコードを開けない不具合があった。
  // 商品単価マスタにも同じ処理が抜けていたため追加)
  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");

  useEffect(() => {
    if (urlEditId && form.prices.length > 0) {
      const target = form.prices.find((p) => p.id === urlEditId);
      if (target) {
        handleSelectPrice(target);
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId, form.prices]);

  if (permsLoading) {
    return <LoadingGate />;
  }

  if (!canRead) {
    return <AccessDeniedInline />;
  }

  return (
    <div className="w-full space-y-6">
      {/* 1. 画面ヘッダー */}
      <PageHeader
        title="💰 品目単価マスタ"
        description="特定の得意先・仕入先、あるいは大口発注ロットに応じた個別契約単価を設定・管理します。"
        actions={
          <>
            <button
              onClick={form.handleDownloadCsv}
              disabled={!canCreate && !canUpdate}
              className={`text-xs border px-3 py-1.5 rounded font-bold text-white transition-colors shadow-sm ${
                canCreate || canUpdate
                  ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
                  : "bg-slate-300 text-slate-500 border-slate-300 cursor-not-allowed"
              }`}
            >
              📥 CSVダウンロード
            </button>
          </>
        }
      />

      {/* 2. アラートメッセージ */}
      <MessageBanner message={form.message} error={form.error} />

      {/* 3. 検索パネル (Propsバインドを修正) */}
      <SearchPanel
        searchItemId={form.searchItemId}
        setSearchItemId={form.setSearchItemId}
        searchPriceType={form.searchPriceType}
        setSearchPriceType={form.setSearchPriceType}
        searchPartnerId={form.searchPartnerId}
        setSearchPartnerId={form.setSearchPartnerId}
        searchStatus={form.searchStatus}
        setSearchStatus={form.setSearchStatus}
        partners={form.partners}
        onClear={form.handleClearFilters}
      />

      {/* 4. サブバー(ステータスタブ ＆ 操作ボタン) */}
      <div className="flex flex-wrap justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <div className="min-w-72 shrink-0">
          <StatusTabs
            options={[
              { value: "active", label: "🟢 有効" },
              { value: "temporary", label: "🟡 仮登録" },
              { value: "suspended", label: "🔴 無効" },
              { value: "", label: "🌐 すべて" },
            ]}
            value={filterStatus}
            onChange={(v) => {
              setFilterStatus(v);
              form.setSearchStatus(v);
            }}
          />
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
            📊 該当件数:{" "}
            <span className="text-sm font-black text-indigo-600">
              {form.total}
            </span>{" "}
            件
          </span>
          <Button
            size="sm"
            onClick={async () => {
              if (showForm) {
                if ((await guard.confirmDiscard())) form.handleCloseForm();
              } else {
                setShowForm(true);
              }
            }}
          >
            {showForm ? "キャンセル" : "➕ 新規個別登録・CSVインポート"}
          </Button>
        </div>
      </div>

      {/* 5. フォーム ＆ CSVインポートパネル (トグル表示) */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <PriceForm
            form={form}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isProductPriceWfEnabled={isProductPriceWfEnabled}
            departments={departments}
            onSubmitSuccess={() => setShowForm(false)}
          />
          <CsvImportPanel
            title="単価契約"
            headerFormat="id,itemId,priceType,partnerId,minQuantity,unitPrice,unitCode,status"
            canCreate={canCreate}
            editingId={form.editingId}
            isProductPriceWfEnabled={isProductPriceWfEnabled}
            onImport={form.handleImportCsvFile}
          />
        </div>
      )}

      {/* 6. 一覧テーブル */}
      <PriceTable
        prices={form.prices}
        items={form.items}
        partners={form.partners}
        editingId={form.editingId}
        canUpdate={canUpdate}
        canDelete={canDelete}
        onEditSelect={handleSelectPrice}
        onDeletePrice={form.handleDeletePrice}
        onSuspendPrice={form.handleSuspendPrice}
        isSubmitting={form.isSubmitting}
        sortBy={form.sortBy}
        sortDirection={form.sortDirection}
        sortKeys={form.sortKeys}
        onSortChange={form.setSort}
      />

      <Pagination
        paginationEnabled={form.paginationEnabled}
        page={form.page}
        totalPages={form.totalPages}
        total={form.total}
        limit={form.limit}
        onPageChange={form.setPage}
        onLimitChange={form.setLimit}
      />
    </div>
  );
}
