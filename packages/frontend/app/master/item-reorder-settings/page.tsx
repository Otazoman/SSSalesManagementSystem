"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { usePagePermissions } from "../../hooks/use-page-permission";
import {
  ItemReorderSettingRecord,
  ItemLookup,
  WarehouseLookup,
} from "./_types";
import { ItemReorderSettingForm } from "./_components/ItemReorderSettingForm";
import { ItemReorderSettingCsvImport } from "./_components/ItemReorderSettingCsvImport";
import { ItemReorderSettingTable } from "./_components/ItemReorderSettingTable";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../_shared/hooks/use-paginated-list";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { todayJst } from "../../_shared/jst-date";
import { useConfirm } from "../../_shared/hooks/use-confirm";

export default function ItemReorderSettingsPage() {
  const confirm = useConfirm();
  const { canCreate, canRead, canUpdate, canDelete, loading } =
    usePagePermissions();

  const [showForm, setShowForm] = useState(false);
  const [items, setItems] = useState<ItemLookup[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLookup[]>([]);
  const [editingData, setEditingData] =
    useState<ItemReorderSettingRecord | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // この画面には画面上のページネーションUIが無いため常にpaginationEnabled:falseで全件取得する
  // (ヘッダクリックソートの横展開のみが目的、一覧の取得方式自体は変更しない)
  const {
    items: settings,
    refetch: loadSettings,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<ItemReorderSettingRecord>("/api/item-reorder-settings", {
    paginationEnabled: false,
    enabled: canRead && !loading,
  });

  useEffect(() => {
    if (loading || !canRead) return;
    // マスタ選択肢の取得(品目/倉庫)は互いに独立させ、一方の失敗が他方に影響しないようにする
    apiFetch<ItemLookup[]>("/api/products")
      .then(setItems)
      .catch((err) => console.error("品目マスタの取得に失敗しました", err));
    apiFetch<WarehouseLookup[]>("/api/warehouses")
      .then(setWarehouses)
      .catch((err) => console.error("倉庫マスタの取得に失敗しました", err));
  }, [loading, canRead]);

  const onSelectRow = (s: ItemReorderSettingRecord) => {
    setEditingData(s);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setEditingData(null);
    setShowForm(false);
  };

  const guard = useDiscardGuard(showForm);
  const requestCloseForm = async () => {
    if ((await guard.confirmDiscard())) handleCloseForm();
  };

  const handleDelete = async (s: ItemReorderSettingRecord) => {
    if (!canDelete) return;
    if (
      !(await confirm(
        `発注点/安全在庫設定 [${s.itemName} / ${s.warehouseName}] を削除しますか？`,
      ))
    )
      return;
    setError("");
    setMessage("");
    try {
      await apiFetch(`/api/item-reorder-settings/${s.id}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });
      setMessage("発注点/安全在庫設定を削除しました");
      if (editingData?.id === s.id) handleCloseForm();
      await loadSettings();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleDownloadCsv = async () => {
    setMessage("⌛ CSVファイルを生成中...");
    try {
      const res = await fetch("/api/item-reorder-settings/csv-download", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error("サーバー側でのCSV生成に失敗しました");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `item_reorder_settings_export_${todayJst()}.csv`,
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage("📊 CSVファイルのダウンロードが完了しました");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "CSVのダウンロード中にエラーが発生しました",
      );
    }
  };

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setIsSubmitting(true);
    setError("");
    setMessage("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const data = await apiFetch<{ message?: string }>(
        "/api/item-reorder-settings/bulk-register",
        {
          method: "POST",
          body: formData,
          defaultErrorMessage: "インポートに失敗しました",
        },
      );
      setMessage(data.message || "CSVインポートが完了しました");
      await loadSettings();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
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
      {/* ヘッダー */}
      <PageHeader
        title="📉 発注点/安全在庫マスタ"
        description="品目×倉庫単位で発注点・安全在庫を設定し、欠品自動提案(購買申請)の基準として使用します。"
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

      <MessageBanner message={message} error={error} />

      {/* サブバー(該当件数 ＋ フォーム開閉ボタン、他マスタと揃えたスタイル) */}
      <div className="flex justify-end items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full shrink-0">
          📊 該当件数:{" "}
          <span className="text-sm font-black text-indigo-600">
            {settings.length}
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
          {showForm ? "キャンセル" : "➕ 新規個別登録・CSVインポート"}
        </button>
      </div>

      {/* 登録・編集フォーム & CSVインポート(他マスタと揃えた2列グリッド) */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <ItemReorderSettingForm
            initialData={editingData}
            items={items}
            warehouses={warehouses}
            canCreate={canCreate}
            canUpdate={canUpdate}
            onSuccess={(msg) => {
              setMessage(msg);
              setEditingData(null);
              void loadSettings();
            }}
            onError={(msg) => setError(msg)}
            onClear={requestCloseForm}
          />
          <ItemReorderSettingCsvImport
            canCreate={canCreate}
            isSubmitting={isSubmitting}
            onImportCsv={handleImportCsv}
          />
        </div>
      )}

      {/* データ一覧テーブル(全幅表示) */}
      <ItemReorderSettingTable
        settings={settings}
        editingData={editingData}
        canUpdate={canUpdate}
        canDelete={canDelete}
        onStartEdit={onSelectRow}
        onDelete={handleDelete}
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortKeys={sortKeys}
        onSortChange={setSort}
      />
    </div>
  );
}
