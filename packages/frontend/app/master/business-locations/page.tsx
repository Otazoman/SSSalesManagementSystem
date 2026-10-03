"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { BusinessLocationRecord } from "./_types";
import { useBusinessLocationForm } from "./_hooks/useBusinessLocationForm";
import { SearchPanel } from "./_components/SearchPanel";
import { BusinessLocationForm } from "./_components/BusinessLocationForm";
import { BusinessLocationTable } from "./_components/BusinessLocationTable";
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

// 新規要望: 営業拠点マスタ(2026-09-23新設)。倉庫マスタ(master/warehouses)から
// 添付ファイル・受付可能日・連絡先モーダルを除いた簡素な構成。承認ワークフロー・
// CSVインポート/エクスポートは他マスタと同じフル機能パリティで実装する。
export default function AdminBusinessLocationsPage() {
  const confirm = useConfirm();
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isBusinessLocationWfEnabled,
    departments,
    loading: permsLoading,
  } = usePagePermissions();

  const { paginationEnabled } = usePaginationSetting();

  const [filterStatus, setFilterStatus] = useState<string>(
    isBusinessLocationWfEnabled ? "temporary" : "active",
  );
  const [showForm, setShowForm] = useState(false);
  const guard = useDiscardGuard(showForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (isBusinessLocationWfEnabled === true) {
      setFilterStatus("temporary");
    }
  }, [isBusinessLocationWfEnabled]);

  // 🔍 検索条件State
  const [searchId, setSearchId] = useState("");
  const [searchName, setSearchName] = useState("");

  const handleClearSearch = () => {
    setSearchId("");
    setSearchName("");
  };

  const handleSuccess = (successMsg: string) => {
    setMessage(successMsg);
    void syncBusinessLocations();
  };

  const handleClose = () => {
    setShowForm(false);
  };

  const form = useBusinessLocationForm({
    canCreate,
    canUpdate,
    isBusinessLocationWfEnabled,
    departments,
    onSuccess: handleSuccess,
    onError: (msg) => setError(msg),
    onClose: handleClose,
  });

  const searchParams = new URLSearchParams({
    status: filterStatus,
    id: searchId,
    name: searchName,
  });

  const {
    items: businessLocations,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncBusinessLocations,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<BusinessLocationRecord>(
    `/api/business-locations?${searchParams.toString()}`,
    { paginationEnabled, enabled: canRead && !permsLoading },
  );

  // 📥 CSVダウンロード
  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "business_locations_export",
    onError: setError,
  });
  const handleDownloadCsv = async () => {
    setError("");
    setMessage("");
    await downloadCsv(
      `/api/business-locations/csv-download?${searchParams.toString()}`,
    );
  };

  // 📤 CSVインポート
  const handleImportCsvFile = async (file: File) => {
    if (isBusinessLocationWfEnabled) return;
    setError("");
    setMessage("");

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target?.result;
      if (typeof csvText !== "string") return;

      try {
        const data = await apiFetch<{ message?: string }>(
          "/api/business-locations/bulk-register",
          {
            method: "POST",
            json: { csvData: csvText },
            defaultErrorMessage: "インポートに失敗しました",
          },
        );

        setMessage(data.message || "CSVインポートが成功しました");
        void syncBusinessLocations();
      } catch (err: any) {
        setError(err.message);
      }
    };

    reader.readAsText(file, "UTF-8");
  };

  // 🗑️ データ削除
  const handleDeleteBusinessLocation = async (id: string, name: string) => {
    if (!(await confirm(`「${name}」を削除しますか？`))) return;
    setError("");
    setMessage("");
    try {
      await apiFetch(`/api/business-locations/${id}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });
      setMessage("営業拠点情報を削除しました");

      if (form.editingId === id) {
        form.handleCloseForm();
      }
      void syncBusinessLocations();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSelectBusinessLocation = (loc: BusinessLocationRecord) => {
    form.selectBusinessLocationForEdit(loc);
    setShowForm(true);
  };

  // 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");

  useEffect(() => {
    if (urlEditId && businessLocations.length > 0) {
      const target = businessLocations.find((l) => l.id === urlEditId);
      if (target) {
        handleSelectBusinessLocation(target);
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId, businessLocations]);

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
      <PageHeader
        title="📌 営業拠点マスタ"
        description="発注・受注の納品場所選択で使う営業拠点(住所・連絡先)を管理する画面です。"
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

      <MessageBanner message={message} error={error} />

      <SearchPanel
        searchId={searchId}
        setSearchId={setSearchId}
        searchName={searchName}
        setSearchName={setSearchName}
        onClear={handleClearSearch}
      />

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

      {showForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <BusinessLocationForm
            form={form}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isBusinessLocationWfEnabled={isBusinessLocationWfEnabled}
            departments={departments}
            onSubmitSuccess={() => {
              setShowForm(false);
              void syncBusinessLocations();
            }}
          />
          <CsvImportPanel
            canCreate={canCreate}
            editingId={form.editingId}
            isBusinessLocationWfEnabled={isBusinessLocationWfEnabled}
            onImport={handleImportCsvFile}
          />
        </div>
      )}

      <BusinessLocationTable
        businessLocations={businessLocations}
        editingId={form.editingId}
        onSelect={handleSelectBusinessLocation}
        onDelete={handleDeleteBusinessLocation}
        onSuspend={(loc) => {
          void form.handleSuspend(loc).then(() => void syncBusinessLocations());
        }}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSubmitting={form.isSubmitting}
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
