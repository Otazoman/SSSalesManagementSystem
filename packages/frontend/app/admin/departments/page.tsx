"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { usePermissionContext } from "../../context/permissioncontext";
import { useDepartmentSync } from "./_hooks/useDepartmentSync";
import {
  FilterStatus,
  DepartmentFormState,
  DepartmentTreeNode,
} from "./_types";
import DepartmentForm from "./_components/DepartmentForm";
import DepartmentTable from "./_components/DepartmentTable";
import { DepartmentSearchPanel } from "./_components/DepartmentSearchPanel";
import { CsvImportPanel } from "./_components/CsvImportPanel";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { useCsvDownload } from "../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../_shared/hooks/use-csv-import";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { useConfirm } from "../../_shared/hooks/use-confirm";

const initialFormState: DepartmentFormState = {
  deptId: "",
  deptName: "",
  deptParent: "",
  deptMemo: "",
  deptValidFrom: "",
  deptValidTo: "",
};

export default function AdminDepartmentsPage() {
  const confirm = useConfirm();
  const { user } = usePermissionContext();
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    loading: loadingPermissions,
  } = usePagePermissions();

  const [filterStatus, setFilterStatus] = useState<FilterStatus>("active");
  const [targetDate, setTargetDate] = useState<string>(() => {
    return new Date().toLocaleDateString("sv-SE");
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { departments, syncMasterData } = useDepartmentSync({
    filterStatus,
    targetDate,
    canRead,
    loadingPermissions,
  });

  const [showDeptForm, setShowDeptForm] = useState(false);
  const guard = useDiscardGuard(showDeptForm);
  const [editingSurrogateId, setEditingSurrogateId] = useState<string | null>(
    null,
  );
  const [formState, setFormState] =
    useState<DepartmentFormState>(initialFormState);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "departments_export",
    onError: setError,
  });
  const { importCsv } = useCsvImport({
    onSuccess: syncMasterData,
    onMessage: setMessage,
    onError: setError,
  });

  if (loadingPermissions) {
    return <LoadingGate label="ユーザー権限を確認中..." />;
  }

  if (!canRead) {
    return (
      <AccessDeniedInline
        title="アクセス権限エラー"
        description="この画面を閲覧する権限がありません。"
      />
    );
  }

  const handleCsvDownload = async () => {
    if (!canRead || isSubmitting) return;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      const effectiveDate = targetDate.trim()
        ? targetDate
        : new Date().toLocaleDateString("sv-SE");
      const params = new URLSearchParams({
        status: filterStatus,
        targetDate: `${effectiveDate}T00:00:00.000Z`,
      });
      await downloadCsv(`/api/departments/csv-download?${params.toString()}`);
      setMessage("CSVファイルをダウンロードしました");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDepartmentCsv = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!canCreate || isSubmitting) return;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await importCsv("/api/departments/bulk-register", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeptSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (editingSurrogateId && !canUpdate) {
      setError("⚠️ 部署情報を変更する権限がありません");
      return;
    }
    if (!editingSurrogateId && !canCreate) {
      setError("⚠️ 新規部署を登録する権限がありません");
      return;
    }

    const targetId = formState.deptId.trim();
    if (formState.deptParent && formState.deptParent === targetId) {
      setError("⚠️ 自分自身の組織を親組織に指定することはできません");
      return;
    }

    if (formState.deptValidFrom && formState.deptValidTo) {
      if (new Date(formState.deptValidFrom) > new Date(formState.deptValidTo)) {
        setError(
          "⚠️ 適用開始日には、適用終了日よりも前の日付を設定してください",
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        id: targetId,
        name: formState.deptName.trim(),
        parentDepartmentId: formState.deptParent || null,
        memo: formState.deptMemo.trim() || null,
        validFrom: formState.deptValidFrom
          ? new Date(formState.deptValidFrom).toISOString()
          : new Date().toISOString(),
        validTo: formState.deptValidTo
          ? new Date(formState.deptValidTo).toISOString()
          : null,
      };

      if (editingSurrogateId) {
        await apiFetch(`/api/departments/${editingSurrogateId}`, {
          method: "PUT",
          json: payload,
          defaultErrorMessage: "マスタの更新に失敗しました",
        });
        setMessage("部署情報を修正・更新しました");
      } else {
        await apiFetch("/api/departments/register", {
          method: "POST",
          json: payload,
          defaultErrorMessage: "新規登録に失敗しました",
        });
        setMessage("新しい組織階層定義を追加しました");
      }

      setShowDeptForm(false);
      setEditingSurrogateId(null);
      setFormState(initialFormState);
      void syncMasterData();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (node: DepartmentTreeNode) => {
    setEditingSurrogateId(node.surrogateId || null);
    setShowDeptForm(true);
    setFormState({
      deptId: node.id,
      deptName: node.name,
      deptParent: node.parentDepartmentId || "",
      deptMemo: node.memo || "",
      deptValidFrom: node.validFrom
        ? new Date(node.validFrom).toLocaleDateString("sv-SE")
        : "",
      deptValidTo: node.validTo
        ? new Date(node.validTo).toLocaleDateString("sv-SE")
        : "",
    });
  };

  const handleDeleteClick = async (node: DepartmentTreeNode) => {
    if (isSubmitting) return;
    if (
      !(await confirm(
        `本当に部署 [${node.name}] を無効化しますか？\n適用終了日に当日日付がセットされ、指定日の組織図から外れます。`,
      ))
    )
      return;
    setIsSubmitting(true);
    try {
      await apiFetch(
        `/api/departments/${node.surrogateId || node.id}/suspend`,
        {
          method: "POST",
        },
      );
      void syncMasterData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestoreClick = async (node: DepartmentTreeNode) => {
    if (isSubmitting) return;
    if (
      !(await confirm(
        `部署 [${node.name}] の有効期限を【無期限】として、現在の現役組織図に復元しますか？`,
      ))
    )
      return;
    setIsSubmitting(true);
    try {
      await apiFetch(
        `/api/departments/${node.surrogateId || node.id}/restore`,
        {
          method: "POST",
          json: { name: node.name },
        },
      );
      setFilterStatus("active");
      void syncMasterData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* ヘッダー */}
      <PageHeader
        title="🏢 組織・部署マスタ"
        description="会社の組織階層の定義、指定日時点の過去・未来の組織図の復元参照が行えます。"
        actions={
          <>
            <span className="text-xs text-slate-600 bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
              ログイン中: {user?.name || "---"} ({user?.roleId || "---"})
            </span>
            <button
              onClick={handleCsvDownload}
              disabled={!canRead || isSubmitting}
              className={`text-xs border px-3 py-1.5 rounded font-bold text-white transition-colors shadow-sm ${
                canRead && !isSubmitting
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
      <DepartmentSearchPanel
        targetDate={targetDate}
        setTargetDate={setTargetDate}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        departmentsCount={departments.length}
      />

      {/* サブバー */}
      <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
        <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
          📊 該当組織数:{" "}
          <span className="text-sm font-black text-indigo-600">
            {departments.length}
          </span>{" "}
          組織
        </span>

        <button
          onClick={async () => {
            if (showDeptForm && !(await guard.confirmDiscard())) return;
            setShowDeptForm(!showDeptForm);
            setEditingSurrogateId(null);
            if (!showDeptForm) {
              setFormState(initialFormState);
            }
          }}
          disabled={!canCreate && !canUpdate && !showDeptForm}
          className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${
            canCreate || canUpdate || showDeptForm
              ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          {showDeptForm ? "キャンセル" : "➕ 新規部署登録・CSVインポート"}
        </button>
      </div>

      {/* 登録・編集フォーム & CSVインポート */}
      {showDeptForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <DepartmentForm
            editingSurrogateId={editingSurrogateId}
            canCreate={canCreate}
            canUpdate={canUpdate}
            isSubmitting={isSubmitting}
            departments={departments}
            formState={formState}
            setFormState={setFormState}
            onSubmit={handleDeptSubmit}
          />
          <CsvImportPanel
            canCreate={canCreate}
            editingSurrogateId={editingSurrogateId}
            isSubmitting={isSubmitting}
            onImportCsv={handleDepartmentCsv}
          />
        </div>
      )}

      {/* マスタデータ表示テーブル */}
      <DepartmentTable
        departments={departments}
        targetDate={targetDate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSubmitting={isSubmitting}
        onSelectRow={handleEditClick}
        onDeleteClick={handleDeleteClick}
        onRestoreClick={handleRestoreClick}
      />
    </div>
  );
}
