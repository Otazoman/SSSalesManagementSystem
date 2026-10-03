// app/products/page.tsx
"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import {
  ItemRecord,
  AccountLookup,
  UnitLookup,
  SupplierLookup,
  TaxCategoryLookup,
} from "./_types";
import { SearchPanel } from "./_components/SearchPanel";
import { ProductForm } from "./_components/ProductForm";
import { CsvImportPanel } from "./_components/CsvImportPanel";
import { ProductTable } from "./_components/ProductTable";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../_shared/hooks/use-csv-download";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";
import { useConfirm } from "../../_shared/hooks/use-confirm";

interface PartnerLookup {
  id: string;
  name: string;
  type: "CUSTOMER" | "SUPPLIER" | "BOTH";
}

export default function AdminProductsPage() {
  const confirm = useConfirm();
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isProductWfEnabled,
    departments,
    loading,
  } = usePagePermissions();

  const { paginationEnabled } = usePaginationSetting();

  const [accounts, setAccounts] = useState<AccountLookup[]>([]);
  const [units, setUnits] = useState<UnitLookup[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierLookup[]>([]);
  const [taxCategories, setTaxCategories] = useState<TaxCategoryLookup[]>([]);

  // 検索・フィルタリングState
  const [filterStatus, setFilterStatus] = useState<string>(
    isProductWfEnabled ? "temporary" : "active",
  );

  useEffect(() => {
    if (isProductWfEnabled === true) {
      setFilterStatus("temporary");
    }
  }, [isProductWfEnabled]);
  const [searchId, setSearchId] = useState("");
  const [searchName, setSearchName] = useState("");
  const [searchNameMode, setSearchNameMode] = useState<"partial" | "exact">(
    "partial",
  );
  const [searchBarcode, setSearchBarcode] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  // フォームUI制御State
  const [showForm, setShowForm] = useState(false);
  const guard = useDiscardGuard(showForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeFormData, setActiveFormData] = useState<ItemRecord | null>(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 初期マスタデータ（商品一覧以外の選択肢）の並行フェッチ
  useEffect(() => {
    if (loading || !canRead) return;

    async function loadLookups() {
      try {
        const [custData, unitData, accData, taxData] = await Promise.all([
          apiFetch<PartnerLookup[]>("/api/partners?status=active"),
          apiFetch<UnitLookup[]>("/api/units"),
          apiFetch<AccountLookup[]>("/api/accounts"),
          apiFetch<TaxCategoryLookup[]>("/api/tax-categories"),
        ]);

        setSuppliers(custData.filter((c) => c.type === "SUPPLIER"));
        setUnits(unitData);
        setAccounts(accData);
        setTaxCategories(taxData);
      } catch (e) {
        console.error("マスタ取得エラー", e);
      }
    }
    void loadLookups();
  }, [loading, canRead]);

  // データ一覧のフェッチ＆同期
  const searchParams = new URLSearchParams();
  if (filterStatus && filterStatus !== "all")
    searchParams.set("status", filterStatus);
  if (searchId) searchParams.set("id", searchId);
  if (searchName) searchParams.set("name", searchName);
  if (searchNameMode) searchParams.set("nameMode", searchNameMode);
  if (searchBarcode) searchParams.set("barcode", searchBarcode);
  if (searchFilter) searchParams.set("filter", searchFilter);

  const {
    items,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncItems,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<ItemRecord>(`/api/products?${searchParams.toString()}`, {
    paginationEnabled,
    enabled: canRead && !loading,
  });

  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "products_master",
    onError: () => setError("CSVダウンロードに失敗しました"),
  });

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

  const handleClearSearch = () => {
    setSearchId("");
    setSearchName("");
    setSearchNameMode("partial");
    setSearchBarcode("");
    setSearchFilter("");
  };

  const handleFormClear = () => {
    setActiveFormData(null);
    setEditingId(null);
  };

  const handleEditInit = (item: ItemRecord) => {
    setActiveFormData(item);
    setEditingId(item.id);
    setShowForm(true);
  };

  // 💡 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  // (以前は単位マスタ等に無く、差戻し修正が正しく該当レコードを開けない不具合があった。
  // 商品マスタにも同じ処理が抜けていたため追加)
  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");

  useEffect(() => {
    if (urlEditId && items.length > 0) {
      const target = items.find((i) => i.id === urlEditId);
      if (target) {
        handleEditInit(target);
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId, items]);

  // 無効化。取引先・単位等と同じく、承認機能有効時は直接無効化せず承認申請を経由する。
  const handleSuspend = async (item: ItemRecord) => {
    if (!(await confirm(`「${item.name}」の利用を停止(無効化)しますか？`))) return;

    try {
      if (isProductWfEnabled) {
        await apiFetch(`/api/products/${item.id}`, {
          method: "PUT",
          json: {
            name: item.name,
            isPurchased: item.isPurchased,
            isSales: item.isSales,
            isService: item.isService,
            baseUnitCode: item.baseUnitCode,
            taxCategoryCode: item.taxCategoryCode,
            productBarcode: item.productBarcode,
            accountCode: item.accountCode,
            memo: item.memo,
            standardSalesPrice: item.standardSalesPrice || 0,
            standardPurchasePrice: item.standardPurchasePrice || 0,
            supplierId: item.supplierId,
            supplierPartNumber: item.supplierPartNumber,
            attachments: item.attachments || [],
            status: "temporary",
          },
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_products",
            targetId: item.id,
            requestType: "UPDATE",
            payload: {
              name: item.name,
              isPurchased: item.isPurchased,
              isSales: item.isSales,
              isService: item.isService,
              baseUnitCode: item.baseUnitCode,
              taxCategoryCode: item.taxCategoryCode,
              productBarcode: item.productBarcode,
              accountCode: item.accountCode,
              memo: item.memo,
              standardSalesPrice: item.standardSalesPrice || 0,
              standardPurchasePrice: item.standardPurchasePrice || 0,
              supplierId: item.supplierId,
              supplierPartNumber: item.supplierPartNumber,
              attachments: item.attachments || [],
              status: "suspended",
            },
            comment: `品目[${item.id}] 無効化申請`,
          },
          defaultErrorMessage: "無効化の申請に失敗しました",
        });

        setMessage("品目の無効化をワークフローへ申請しました(承認待ちロック)");
      } else {
        await apiFetch(`/api/products/${item.id}/suspend`, { method: "POST" });
      }
      void syncItems();
    } catch (e) {
      if (e instanceof Error) setError(e.message);
    }
  };

  const handlePurge = async (id: string, name: string) => {
    if (!canDelete) return;
    if (!(await confirm(`⚠️ 警告: 品目「${name}」をマスタから完全に消去しますか？`)))
      return;

    try {
      await apiFetch(`/api/products/${id}`, {
        method: "DELETE",
        defaultErrorMessage: "物理削除に失敗しました",
      });

      setMessage(`品目「${name}」を完全に削除しました`);
      void syncItems();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleDownloadCsv = async () => {
    if (!canCreate && !canUpdate) return;
    await downloadCsv(`/api/products/csv-download?${searchParams.toString()}`);
  };

  return (
    <div className="w-full space-y-6">
      {/* 画面ヘッダー */}
      <PageHeader
        title="📦 品目マスタ"
        description="品目属性、自動仕訳用勘定科目、および承認ステータスを統合管理します。"
        actions={
          <>
            <Button
              variant="success"
              size="sm"
              className="border"
              onClick={handleDownloadCsv}
              disabled={!canCreate && !canUpdate}
            >
              {!canCreate && !canUpdate
                ? "🔒 CSVダウンロード権限なし"
                : "📥 CSVダウンロード"}
            </Button>
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      {/* 🔎 検索パネル */}
      <SearchPanel
        searchId={searchId}
        setSearchId={setSearchId}
        searchName={searchName}
        setSearchName={setSearchName}
        searchNameMode={searchNameMode}
        setSearchNameMode={setSearchNameMode}
        searchBarcode={searchBarcode}
        setSearchBarcode={setSearchBarcode}
        searchFilter={searchFilter}
        setSearchFilter={setSearchFilter}
        onClear={handleClearSearch}
      />

      {/* サブバー */}
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
        <div className="flex items-center space-x-4">
          <span className="text-xs font-bold text-slate-600 bg-white border px-2.5 py-1.5 rounded shadow-sm">
            該当件数:{" "}
            <span className="text-indigo-600 font-mono text-sm">{total}</span>{" "}
            件
          </span>
          <Button
            size="sm"
            onClick={async () => {
              if (showForm) {
                if (!(await guard.confirmDiscard())) return;
                handleFormClear();
              }
              setShowForm(!showForm);
            }}
            disabled={!canCreate}
          >
            {showForm ? "キャンセル" : "➕ 新規品目個別登録・CSVインポート"}
          </Button>
        </div>
      </div>

      {/* 登録・一括管理フォーム */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <ProductForm
            editingId={editingId}
            onClear={handleFormClear}
            onSuccess={(msg) => {
              setMessage(msg);
              void syncItems();
            }}
            onError={(msg) => setError(msg)}
            accounts={accounts}
            units={units}
            suppliers={suppliers}
            taxCategories={taxCategories}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isProductWfEnabled={isProductWfEnabled}
            departments={departments}
            initialData={activeFormData}
          />
          {!editingId ? (
            <CsvImportPanel
              canCreate={canCreate}
              isProductWfEnabled={isProductWfEnabled}
              onSuccess={(msg) => setMessage(msg)}
              onError={(msg) => setError(msg)}
              onImportComplete={() => void syncItems()}
            />
          ) : (
            <div className="bg-white p-6 rounded-lg border border-slate-200 flex flex-col justify-center items-center text-center text-slate-500">
              <span className="text-xl mb-1">📝</span>
              <p className="text-[11px] font-medium">
                個別レコードの「変更」修正モード中は、CSV一括インポートを実行できません。
              </p>
            </div>
          )}
        </div>
      )}

      {/* データ一覧テーブル */}
      <ProductTable
        items={items}
        accounts={accounts}
        suppliers={suppliers}
        taxCategories={taxCategories}
        canUpdate={canUpdate}
        canDelete={canDelete}
        onEdit={handleEditInit}
        onSuspend={handleSuspend}
        onPurge={handlePurge}
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
