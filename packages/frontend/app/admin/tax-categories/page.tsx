"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { TaxCategoryRecord } from "./_types";
import { TaxCategoryForm } from "./_components/TaxCategoryForm";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../_shared/hooks/use-paginated-list";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { DataTable } from "../../_shared/ui/DataTable";
import { Button } from "../../_shared/ui/Button";
import { useCsvDownload } from "../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../_shared/hooks/use-csv-import";
import { useConfirm } from "../../_shared/hooks/use-confirm";

// BUG-039: CSVインポートのテンプレート(列はCSVダウンロードと同じ。validFrom・validTo は任意、日付は YYYY-MM-DD)
const TAX_CATEGORY_CSV_TEMPLATE = [
  "code,name,taxType,taxRate,validFrom,validTo",
  "TAX_10,10%標準税率,STANDARD,0.1,2019-10-01,",
  "TAX_8_REDUCED,8%軽減税率,STANDARD,0.08,2019-10-01,",
  "TAX_EXEMPT,非課税,EXEMPT,0,,",
].join("\n");

export default function TaxCategoriesPage() {
  const confirm = useConfirm();
  const { canCreate, canRead, canUpdate, canDelete, loading } =
    usePagePermissions();

  const [editingData, setEditingData] = useState<TaxCategoryRecord | null>(
    null,
  );
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // この画面には画面上のページネーションUIが無いため常にpaginationEnabled:falseで全件取得する
  // (ヘッダクリックソートの横展開のみが目的、一覧の取得方式自体は変更しない)
  const {
    items: categories,
    refetch: loadCategories,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<TaxCategoryRecord>("/api/tax-categories", {
    paginationEnabled: false,
    enabled: canRead && !loading,
  });

  // BUG-039: 他のマスタと同じく、CSVダウンロード・CSVインポート・テンプレートを用意する
  const { download: downloadCsv, downloading } = useCsvDownload({
    fileNamePrefix: "tax_categories_export",
    onError: setError,
  });
  const { importCsv, importing } = useCsvImport({
    onSuccess: loadCategories,
    onMessage: setMessage,
    onError: setError,
  });
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError("");
    setMessage("");
    await importCsv("/api/tax-categories/bulk-register", e);
  };
  const handleDownloadTemplate = () => {
    const blob = new Blob([`\uFEFF${TAX_CATEGORY_CSV_TEMPLATE}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tax_categories_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (c: TaxCategoryRecord) => {
    if (!canDelete) return;
    if (!(await confirm(`消費税区分 [${c.code}: ${c.name}] を削除しますか？`))) return;
    setError("");
    setMessage("");
    try {
      await apiFetch(`/api/tax-categories/${c.code}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });
      setMessage("消費税区分を削除しました");
      if (editingData?.code === c.code) {
        setEditingData(null);
        setShowForm(false);
      }
      await loadCategories();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingData(null);
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

  return (
    <div className="w-full space-y-6 text-slate-900">
      <PageHeader
        title="⚙️ 消費税マスタ"
        description="税制改正(税率変更・軽減税率追加など)に対応するための税区分を登録・管理します。"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={downloading}
              onClick={() =>
                void downloadCsv("/api/tax-categories/csv-download")
              }
            >
              📥 CSVダウンロード
            </Button>
            {canCreate && canUpdate && (
              <>
                <label
                  className={`inline-flex items-center rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm ${
                    importing
                      ? "cursor-not-allowed opacity-60"
                      : "cursor-pointer hover:bg-slate-50"
                  }`}
                >
                  📤 CSVインポート
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    disabled={importing}
                    onChange={(e) => void handleImportCsv(e)}
                  />
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDownloadTemplate}
                >
                  📄 テンプレート
                </Button>
              </>
            )}
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      {/* サブバー */}
      <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
        <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
          📊 該当件数:{" "}
          <span className="text-sm font-black text-indigo-600">
            {categories.length}
          </span>{" "}
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
          {showForm ? "キャンセル" : "➕ 新規個別登録"}
        </button>
      </div>

      {/* 登録・編集フォーム */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <div className="max-w-xl">
            <TaxCategoryForm
              initialData={editingData}
              canCreate={canCreate}
              canUpdate={canUpdate}
              onSuccess={(msg) => {
                setMessage(msg);
                setEditingData(null);
                setShowForm(false);
                void loadCategories();
              }}
              onError={(msg) => setError(msg)}
              onClear={requestCloseForm}
            />
          </div>
        </div>
      )}

      {/* データ一覧テーブル */}
      <DataTable
        columns={[
          { key: "code", label: "コード", sortable: true },
          { key: "name", label: "名称", sortable: true },
          { key: "taxType", label: "区分", sortable: true },
          { key: "taxRate", label: "税率", sortable: true },
          { key: "actions", label: "操作", align: "center" },
        ]}
        data={categories}
        emptyMessage="該当するデータはありません"
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortKeys={sortKeys}
        onSortChange={setSort}
        renderRow={(c) => (
          <tr
            key={c.code}
            className="hover:bg-slate-50 transition-colors cursor-pointer"
            onClick={() => {
              if (!canUpdate) return;
              setEditingData(c);
              setShowForm(true);
            }}
          >
            <td className="px-4 py-3 font-mono font-bold text-slate-900">
              {c.code}
            </td>
            <td className="px-4 py-3 font-semibold text-slate-800">{c.name}</td>
            <td className="px-4 py-3">
              <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded text-[10px] font-bold">
                {c.taxType}
              </span>
            </td>
            <td className="px-4 py-3 font-bold text-indigo-600">
              {(c.taxRate * 100).toFixed(0)}%
            </td>
            <td
              className="px-4 py-3 text-center space-x-3 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  setEditingData(c);
                  setShowForm(true);
                }}
                disabled={!canUpdate}
                className={`font-bold ${
                  canUpdate
                    ? "text-indigo-600 hover:underline cursor-pointer"
                    : "text-slate-500 opacity-60 no-underline cursor-not-allowed"
                }`}
              >
                編集
              </button>
              <button
                onClick={() => void handleDelete(c)}
                disabled={!canDelete}
                className={`font-bold ${
                  canDelete
                    ? "text-red-600 hover:underline cursor-pointer"
                    : "text-slate-500 opacity-60 no-underline cursor-not-allowed"
                }`}
              >
                削除
              </button>
            </td>
          </tr>
        )}
      />
    </div>
  );
}
