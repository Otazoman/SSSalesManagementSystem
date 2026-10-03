"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { UserRecord, DepartmentRecord, RoleRecord } from "./_types";
import { SearchPanel } from "./_components/SearchPanel";
import { UserForm } from "./_components/UserForm";
import { CsvImportPanel } from "./_components/CsvImportPanel";
import { UserTable } from "./_components/UserTable";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../_shared/hooks/use-csv-import";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";
import { useConfirm } from "../../_shared/hooks/use-confirm";

export default function AdminUsersPage() {
  const confirm = useConfirm();
  const {
    canRead: hasMenu,
    canRead: hasRead,
    canCreate: hasCreate,
    canUpdate: hasUpdate,
    canDelete: hasDelete,
  } = usePagePermissions();

  const { paginationEnabled } = usePaginationSetting();

  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);

  const [filterStatus, setFilterStatus] = useState<
    "active" | "inactive" | "all"
  >("active");
  const [showUserForm, setShowUserForm] = useState(false);
  const guard = useDiscardGuard(showUserForm);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 検索用の State
  const [searchEmpNum, setSearchEmpNum] = useState("");
  const [searchName, setSearchName] = useState("");
  const [searchNameMode, setSearchNameMode] = useState<"partial" | "exact">(
    "partial",
  );
  const [searchEmail, setSearchEmail] = useState("");
  const [searchEmailMode, setSearchEmailMode] = useState<"partial" | "exact">(
    "partial",
  );
  const [searchDeptId, setSearchDeptId] = useState("");
  const [searchRoleId, setSearchRoleId] = useState("");

  const hasFormPermission = editingUserId ? hasUpdate : hasCreate;

  const handleClearSearch = () => {
    setSearchEmpNum("");
    setSearchName("");
    setSearchNameMode("partial");
    setSearchEmail("");
    setSearchEmailMode("partial");
    setSearchDeptId("");
    setSearchRoleId("");
  };

  // 部署・ロールの選択肢マスタを取得
  useEffect(() => {
    if (!hasMenu || !hasRead) return;
    async function loadLookups() {
      try {
        const todayStr =
          new Date().toLocaleDateString("sv-SE") + "T00:00:00.000Z";
        const [deptData, roleData] = await Promise.all([
          apiFetch<DepartmentRecord[]>(
            `/api/departments?status=active&targetDate=${todayStr}`,
          ),
          apiFetch<RoleRecord[]>("/api/roles"),
        ]);
        setDepartments(deptData);
        setRoles(roleData);
      } catch (err) {
        console.error("マスタ取得エラー", err);
      }
    }
    void loadLookups();
  }, [hasMenu, hasRead]);

  const queryParams = new URLSearchParams({
    status: filterStatus,
    employeeNumber: searchEmpNum,
    name: searchName,
    nameMode: searchNameMode,
    email: searchEmail,
    emailMode: searchEmailMode,
    departmentId: searchDeptId,
    roleId: searchRoleId,
  });

  const {
    items: users,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncMasterData,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<UserRecord>(`/api/users?${queryParams.toString()}`, {
    paginationEnabled,
    enabled: hasMenu && hasRead,
  });

  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "users_export",
    onError: setError,
  });
  const handleCsvDownload = async () => {
    if (!hasRead || isSubmitting) return;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await downloadCsv(`/api/users/csv-download?${queryParams.toString()}`);
      setMessage("CSVファイルをダウンロードしました");
    } finally {
      setIsSubmitting(false);
    }
  };

  const { importCsv } = useCsvImport({
    onSuccess: syncMasterData,
    onMessage: setMessage,
    onError: setError,
  });
  const handleUserCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hasCreate || isSubmitting) return;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await importCsv("/api/users/bulk-register", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePurgeUser = async (id: string, name: string) => {
    if (!hasDelete || isSubmitting) return;
    if (
      !(await confirm(
        `【警告】ユーザー「${name}」のアカウントデータを完全に消去しますか？`,
      ))
    )
      return;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/users/${id}/purge`, {
        method: "DELETE",
        defaultErrorMessage: "完全削除に失敗しました",
      });

      setMessage("アカウントを完全に消去しました");
      await syncMasterData();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormSuccess = () => {
    setShowUserForm(false);
    setEditingUserId(null);
    void syncMasterData();
  };

  const handleRowSelection = (u: UserRecord) => {
    setEditingUserId(u.id);
    setShowUserForm(true);
  };

  if (!hasMenu) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* ヘッダー */}
      <PageHeader
        title="👥 ユーザー管理"
        description="所属部署と権限ロールを機能的にセット管理する高度マスタ画面です。"
        actions={
          <>
            <button
              onClick={handleCsvDownload}
              disabled={!hasRead || isSubmitting}
              className={`text-xs border px-3 py-1.5 rounded font-bold text-white transition-colors shadow-sm ${
                hasRead && !isSubmitting
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

      {/* 検索パネル */}
      <SearchPanel
        searchEmpNum={searchEmpNum}
        setSearchEmpNum={setSearchEmpNum}
        searchName={searchName}
        setSearchName={setSearchName}
        searchNameMode={searchNameMode}
        setSearchNameMode={setSearchNameMode}
        searchEmail={searchEmail}
        setSearchEmail={setSearchEmail}
        searchEmailMode={searchEmailMode}
        setSearchEmailMode={setSearchEmailMode}
        searchDeptId={searchDeptId}
        setSearchDeptId={setSearchDeptId}
        searchRoleId={searchRoleId}
        setSearchRoleId={setSearchRoleId}
        onClearSearch={handleClearSearch}
        departments={departments}
        roles={roles}
      />

      {/* サブバー */}
      <div className="flex flex-wrap justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <div className="min-w-72 shrink-0">
          <StatusTabs
            options={[
              { value: "active", label: "🟢 有効なユーザー" },
              { value: "inactive", label: "🔴 無効・退職者" },
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
          <button
            onClick={async () => {
              if (showUserForm) {
                if (!(await guard.confirmDiscard())) return;
                setShowUserForm(false);
                setEditingUserId(null);
              } else {
                setShowUserForm(true);
              }
            }}
            disabled={!hasCreate && !showUserForm}
            className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${
              hasCreate || showUserForm
                ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                : "bg-slate-300 text-slate-500 cursor-not-allowed"
            }`}
          >
            {showUserForm ? "キャンセル" : "➕ 新規個別登録・CSVインポート"}
          </button>
        </div>
      </div>

      {/* 登録・編集フォーム & CSVインポート */}
      {showUserForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <UserForm
            editingUserId={editingUserId}
            users={users}
            departments={departments}
            roles={roles}
            hasCreate={hasCreate}
            hasUpdate={hasUpdate}
            hasFormPermission={hasFormPermission}
            isSubmitting={isSubmitting}
            onSuccess={handleFormSuccess}
            setError={setError}
            setMessage={setMessage}
          />
          <CsvImportPanel
            hasCreate={hasCreate}
            editingUserId={editingUserId}
            isSubmitting={isSubmitting}
            onImportCsv={handleUserCsv}
          />
        </div>
      )}

      {/* データ一覧テーブル */}
      <UserTable
        users={users}
        hasUpdate={hasUpdate}
        hasDelete={hasDelete}
        isSubmitting={isSubmitting}
        onSelectRow={handleRowSelection}
        onPurgeClick={handlePurgeUser}
        syncMasterData={syncMasterData}
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
