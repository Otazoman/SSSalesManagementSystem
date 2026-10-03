"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { WarehouseRecord } from "./_types";
import { useWarehouseForm } from "./_hooks/useWarehouseForm";
import { SearchPanel } from "./_components/SearchPanel";
import { WarehouseForm } from "./_components/WarehouseForm";
import { WarehouseTable } from "./_components/WarehouseTable";
import { WarehouseContactsModal } from "./_components/WarehouseContactsModal";
import CsvImportPanel from "./_components/CsvImportPanel";
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

export default function AdminWarehousesPage() {
  const confirm = useConfirm();
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isWarehouseWfEnabled,
    departments,
    loading: permsLoading,
  } = usePagePermissions();

  const { paginationEnabled } = usePaginationSetting();

  const [filterStatus, setFilterStatus] = useState<string>(
    isWarehouseWfEnabled ? "temporary" : "active",
  );
  const [showForm, setShowForm] = useState(false);
  const guard = useDiscardGuard(showForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [contactsModalTarget, setContactsModalTarget] =
    useState<WarehouseRecord | null>(null);

  useEffect(() => {
    if (isWarehouseWfEnabled === true) {
      setFilterStatus("temporary");
    }
  }, [isWarehouseWfEnabled]);

  // 🔍 検索条件State (searchStatusを削除)
  const [searchId, setSearchId] = useState("");
  const [searchName, setSearchName] = useState("");

  const handleClearSearch = () => {
    setSearchId("");
    setSearchName("");
  };

  const handleSuccess = (successMsg: string) => {
    setMessage(successMsg);
    void syncWarehouses();
  };

  const handleClose = () => {
    setShowForm(false);
  };

  // 🚀 フォーム専用カスタムフック
  const form = useWarehouseForm({
    canCreate,
    canUpdate,
    isWarehouseWfEnabled,
    departments,
    onSuccess: handleSuccess,
    onError: (msg) => setError(msg),
    onClose: handleClose,
  });

  // 🔄 倉庫リストの同期 (statusはfilterStatusを直接渡す)
  const searchParams = new URLSearchParams({
    status: filterStatus,
    id: searchId,
    name: searchName,
  });

  const {
    items: warehouses,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncWarehouses,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<WarehouseRecord>(
    `/api/warehouses?${searchParams.toString()}`,
    { paginationEnabled, enabled: canRead && !permsLoading },
  );

  // 📥 CSVダウンロード
  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "warehouses_export",
    onError: setError,
  });
  const handleDownloadCsv = async () => {
    setError("");
    setMessage("");
    await downloadCsv(
      `/api/warehouses/csv-download?${searchParams.toString()}`,
    );
  };

  // 📤 CSVインポート
  const handleImportCsvFile = async (file: File) => {
    if (isWarehouseWfEnabled) return;
    setError("");
    setMessage("");

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target?.result;
      if (typeof csvText !== "string") return;

      try {
        const data = await apiFetch<{ message?: string }>(
          "/api/warehouses/bulk-register",
          {
            method: "POST",
            json: { csvData: csvText },
            defaultErrorMessage: "インポートに失敗しました",
          },
        );

        setMessage(data.message || "CSVインポートが成功しました");
        void syncWarehouses();
      } catch (err: any) {
        setError(err.message);
      }
    };

    reader.readAsText(file, "UTF-8");
  };

  // 🗑️ データ削除
  const handleDeleteWarehouse = async (id: string, name: string) => {
    if (
      !(await confirm(
        `「${name}」を削除しますか？\n紐づく設定やファイルも連動削除されます。`,
      ))
    )
      return;
    setError("");
    setMessage("");
    try {
      await apiFetch(`/api/warehouses/${id}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });
      setMessage("倉庫情報を削除しました");

      if (form.editingId === id) {
        form.handleCloseForm();
      }
      void syncWarehouses();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 📝 編集ターゲット選択
  const handleSelectWarehouse = (w: WarehouseRecord) => {
    form.selectWarehouseForEdit(w);
    setShowForm(true);
  };

  // 💡 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  // (以前は単位マスタ等に無く、差戻し修正が正しく該当レコードを開けない不具合があった。
  // 倉庫マスタにも同じ処理が抜けていたため追加)
  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");

  useEffect(() => {
    if (urlEditId && warehouses.length > 0) {
      const target = warehouses.find((w) => w.id === urlEditId);
      if (target) {
        handleSelectWarehouse(target);
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId, warehouses]);

  if (permsLoading) {
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
      {/* 1. ヘッダーエリア */}
      <PageHeader
        title="🏢 倉庫マスタ"
        description="自社拠点の倉庫情報およびトラック受入可能日時・制限事項・添付ファイルを管理する画面です。"
        actions={
          <>
            <Button
              variant="success"
              size="sm"
              className="border"
              onClick={handleDownloadCsv}
            >
              📥 CSVダウンロード
            </Button>
          </>
        }
      />

      {/* 2. アラートメッセージエリア */}
      <MessageBanner message={message} error={error} />

      {/* 3. 検索パネル (プロパティ整理) */}
      <SearchPanel
        searchId={searchId}
        setSearchId={setSearchId}
        searchName={searchName}
        setSearchName={setSearchName}
        onClear={handleClearSearch}
      />

      {/* 4. サブバー(ステータスタブ ＆ 操作ボタン) */}
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
          <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
            📊 該当件数:{" "}
            <span className="text-sm font-black text-indigo-600">{total}</span>{" "}
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

      {/* 5. フォーム ＆ CSVインポートパネル */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <WarehouseForm
            form={form}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isWarehouseWfEnabled={isWarehouseWfEnabled}
            departments={departments}
            onSubmitSuccess={() => {
              setShowForm(false);
              void syncWarehouses();
            }}
          />
          <CsvImportPanel
            title="倉庫"
            headerFormat="id,name,postalCode,address,phoneNumber,faxNumber,email,businessStartTime,businessEndTime,storageRestrictions,warehouseType,status,memo"
            canCreate={canCreate}
            editingId={form.editingId}
            isWarehouseWfEnabled={isWarehouseWfEnabled}
            onImport={handleImportCsvFile}
          />
        </div>
      )}

      {/* 6. データ一覧テーブル */}
      <WarehouseTable
        warehouses={warehouses}
        editingId={form.editingId}
        onSelect={handleSelectWarehouse}
        onDelete={handleDeleteWarehouse}
        onSuspend={(w) => {
          void form.handleSuspend(w).then(() => void syncWarehouses());
        }}
        onManageContacts={(w) => setContactsModalTarget(w)}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSubmitting={form.isSubmitting}
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortKeys={sortKeys}
        onSortChange={setSort}
      />

      {contactsModalTarget && (
        <WarehouseContactsModal
          warehouseId={contactsModalTarget.id}
          warehouseName={contactsModalTarget.name}
          canUpdate={canUpdate}
          onClose={() => setContactsModalTarget(null)}
        />
      )}

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
