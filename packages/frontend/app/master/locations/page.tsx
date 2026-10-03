"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { LocationRecord, WarehouseSimple } from "./_types";
import { useLocationForm } from "./_hooks/useLocationForm";
import { SearchPanel } from "./_components/SearchPanel";
import { LocationForm } from "./_components/LocationForm";
import { LocationTable } from "./_components/LocationTable";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../_shared/hooks/use-csv-import";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";
import { useConfirm } from "../../_shared/hooks/use-confirm";

export default function AdminLocationsPage() {
  const confirm = useConfirm();
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isLocationWfEnabled,
    departments,
    loading,
  } = usePagePermissions();

  const { paginationEnabled } = usePaginationSetting();

  const [warehouses, setWarehouses] = useState<WarehouseSimple[]>([]);

  // フォーム開閉表示制御State
  const [showForm, setShowForm] = useState(false);
  const guard = useDiscardGuard(showForm);

  // 🔎 検索パネル用State
  const [searchId, setSearchId] = useState("");
  const [searchWarehouseId, setSearchWarehouseId] = useState("");
  const [searchName, setSearchName] = useState("");

  // 🔎 ステータス絞り込み（取引先マスタと同じパターン）
  const [filterStatus, setFilterStatus] = useState<string>(
    isLocationWfEnabled ? "temporary" : "active",
  );

  useEffect(() => {
    if (isLocationWfEnabled === true) {
      setFilterStatus("temporary");
    }
  }, [isLocationWfEnabled]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleClearSearch = () => {
    setSearchId("");
    setSearchWarehouseId("");
    setSearchName("");
  };

  // フォームフック
  const form = useLocationForm({
    canCreate,
    canUpdate,
    isLocationWfEnabled,
    departments,
    onSuccess: (msg) => setMessage(msg),
    onError: (msg) => setError(msg),
  });

  // 倉庫一覧を取得
  useEffect(() => {
    if (loading || !canRead) return;

    async function fetchWarehouses() {
      try {
        const data = await apiFetch<WarehouseSimple[]>("/api/warehouses");
        setWarehouses(data);
      } catch (err) {
        console.error("倉庫一覧の取得に失敗しました", err);
      }
    }
    void fetchWarehouses();
  }, [loading, canRead]);

  // 🔄 リアルタイムデータ同期
  const searchParams = new URLSearchParams({
    id: searchId,
    warehouseId: searchWarehouseId,
    name: searchName,
    status: filterStatus,
  });

  const {
    items: locations,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncLocations,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<LocationRecord>(
    `/api/locations?${searchParams.toString()}`,
    { paginationEnabled, enabled: canRead && !loading },
  );

  // 📥 CSVダウンロード
  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "locations_export",
    onError: () => setError("CSVダウンロードエラー"),
  });
  const handleDownloadCsv = async () => {
    if (!canCreate && !canUpdate) {
      setError("CSVダウンロードする権限がありません");
      return;
    }
    await downloadCsv(`/api/locations/csv-download?${searchParams.toString()}`);
  };

  // 📤 CSVインポート
  const { importCsv } = useCsvImport({
    onSuccess: syncLocations,
    onMessage: setMessage,
    onError: (msg) => setError(msg || "CSVインポートエラー"),
  });
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canCreate) return;
    await importCsv("/api/locations/bulk-register", e);
  };

  // 🗑️ データ削除
  const handleDeleteLocation = async (l: LocationRecord) => {
    if (!(await confirm(`ロケーション「${l.name}」を削除しますか？`))) return;
    setError("");
    setMessage("");

    try {
      await apiFetch(`/api/locations/${l.id}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });
      setMessage("ロケーション情報を削除しました");

      if (form.editingId === l.id) {
        form.resetForm();
        form.setEditingId(null);
        setShowForm(false);
      }
      await syncLocations();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  // 🚫 無効化
  // 無効化。取引先マスタと同じく、承認機能有効時は直接無効化せず承認申請を経由する。
  const handleSuspendLocation = async (l: LocationRecord) => {
    if (!(await confirm(`ロケーション「${l.name}」を無効化しますか？`))) return;
    setError("");
    setMessage("");

    try {
      if (isLocationWfEnabled) {
        await apiFetch(`/api/locations/${l.id}`, {
          method: "PUT",
          json: {
            warehouseId: l.warehouseId,
            name: l.name,
            memo: l.memo || null,
            status: "temporary",
          },
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_locations",
            targetId: l.id,
            requestType: "UPDATE",
            payload: {
              id: l.id,
              warehouseId: l.warehouseId,
              name: l.name,
              memo: l.memo || null,
              status: "suspended",
            },
            applicantDepartmentSurrogateId: form.applicantDepartmentSurrogateId,
            comment: `ロケーションマスタ[${l.id}] 無効化申請`,
          },
          defaultErrorMessage: "無効化の申請に失敗しました",
        });

        setMessage(
          "ロケーションの無効化をワークフローへ申請しました(承認待ちロック)",
        );
      } else {
        await apiFetch(`/api/locations/${l.id}/suspend`, {
          method: "POST",
          defaultErrorMessage: "無効化に失敗しました",
        });
        setMessage("ロケーションを無効化しました");
      }

      if (form.editingId === l.id) {
        form.resetForm();
        form.setEditingId(null);
        setShowForm(false);
      }
      await syncLocations();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  // 📝 編集ターゲット選択
  const handleSelectLocation = (l: LocationRecord) => {
    form.selectLocationForEdit(l);
    setShowForm(true);
  };

  // 💡 差戻し履歴画面の「修正して再提出」からの遷移(?editId=xxx)を受けて自動的に編集フォームを開く
  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");

  useEffect(() => {
    if (urlEditId && locations.length > 0) {
      const target = locations.find((l) => l.id === urlEditId);
      if (target) {
        handleSelectLocation(target);
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditId, locations]);

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

  const isCsvExportable = canRead && canCreate;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="📍 ロケーションマスタ"
        description="倉庫内の棚番・エリア(ロケーション)を管理する画面です。"
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

      {/* 🔍 検索パネル */}
      <SearchPanel
        searchId={searchId}
        setSearchId={setSearchId}
        searchWarehouseId={searchWarehouseId}
        setSearchWarehouseId={setSearchWarehouseId}
        searchName={searchName}
        setSearchName={setSearchName}
        warehouses={warehouses}
        onClear={handleClearSearch}
      />

      {/* フォーム開閉コントロール */}
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
        <Button
          size="sm"
          onClick={async () => {
            if (showForm && !(await guard.confirmDiscard())) return;
            if (showForm) form.resetForm();
            setShowForm(!showForm);
            form.setEditingId(null);
          }}
        >
          {showForm ? "キャンセル" : "➕ 新規個別登録・CSVインポート"}
        </Button>
      </div>

      {/* 登録・編集フォーム */}
      {showForm && (
        <div className="contents" {...guard.scopeProps}>
          <LocationForm
            form={form}
            warehouses={warehouses}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isLocationWfEnabled={isLocationWfEnabled}
            departments={departments}
            onImportCsv={handleImportCsv}
            onSubmitSuccess={() => {
              setShowForm(false);
              void syncLocations();
            }}
          />
        </div>
      )}

      {/* データ一覧テーブル */}
      <LocationTable
        locations={locations}
        warehouses={warehouses}
        onSelect={handleSelectLocation}
        onDelete={handleDeleteLocation}
        onSuspend={handleSuspendLocation}
        canUpdate={canUpdate}
        canDelete={canDelete}
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
