import { useState, useCallback, useEffect } from "react";
import { UnitRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";
import type { ApplicantDepartmentOption } from "../../../types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UseUnitApiProps {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  permsLoading: boolean;
  isUnitWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
}

export function useUnitApi({
  canRead,
  canCreate,
  canUpdate,
  canDelete,
  permsLoading,
  isUnitWfEnabled = false,
  departments = [],
}: UseUnitApiProps) {
  const confirm = useConfirm();
  const { paginationEnabled } = usePaginationSetting();

  // 追加要望F: 複数部門所属時の申請部門選択(初期値は所属部門の先頭=従来の暗黙動作と同じ)。
  // departmentsはusePagePermissions()から非同期に取得されるため、マウント時点では
  // 空配列のことがある。useState初期値だけでは反映されないため、ロード完了後にuseEffectで
  // 未選択(null)の場合のみ先頭部門を補完する(ユーザーが既に選択した値は上書きしない)。
  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] =
    useState<string | null>(null);
  useEffect(() => {
    if (applicantDepartmentSurrogateId === null && departments.length > 0) {
      setApplicantDepartmentSurrogateId(departments[0].surrogateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);

  // 🔎 ステータス絞り込み（取引先マスタと同じパターン）
  const [filterStatus, setFilterStatus] = useState<string>(
    isUnitWfEnabled ? "temporary" : "active",
  );

  // ワークフロー有効フラグを監視して、Stateの初期値を安全に合わせる
  useEffect(() => {
    if (isUnitWfEnabled === true) {
      setFilterStatus("temporary");
    }
  }, [isUnitWfEnabled]);

  const searchParams = new URLSearchParams({ status: filterStatus });

  const {
    items: units,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncUnits,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<UnitRecord>(`/api/units?${searchParams.toString()}`, {
    paginationEnabled,
    enabled: canRead && !permsLoading,
  });

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string>(
    isUnitWfEnabled ? "temporary" : "active",
  );
  const [editingUnit, setEditingUnit] = useState<UnitRecord | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [wfStatus, setWfStatus] = useState<string | null>(null);

  // 💡 取引先マスタと同じロック機構: 編集中の単位が承認ワークフロー審査中(PENDING)なら、
  // フォームを完全ロックする(上書き・再編集防止)
  const isUnitCurrentlyLocked =
    !!editingUnit && isUnitWfEnabled && status === "temporary" && wfStatus === "PENDING";

  useEffect(() => {
    if (!editingUnit || !isUnitWfEnabled) {
      setWfStatus(null);
      return;
    }

    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingUnit.code}?targetType=master_units`,
        );
        setWfStatus(data.status);
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };

    void fetchWfStatus();
  }, [editingUnit, isUnitWfEnabled, status]);

  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "units_export",
    onError: setError,
  });

  // CSVダウンロード
  const handleDownloadCsv = async () => {
    if (!canRead || isSubmitting) return;
    await downloadCsv("/api/units/csv-download");
  };

  const { importCsv, importing } = useCsvImport({
    onSuccess: syncUnits,
    onMessage: setMessage,
    onError: setError,
  });

  // CSVインポート
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canCreate || isSubmitting || isUnitWfEnabled) return;
    setError("");
    setMessage("");
    await importCsv("/api/units/bulk-register", e);
  };

  // 編集をキャンセルしてリセット
  const handleCancelEdit = useCallback(() => {
    setEditingUnit(null);
    setCode("");
    setName("");
    setStatus(isUnitWfEnabled ? "temporary" : "active");
    setWfStatus(null);
  }, [isUnitWfEnabled]);

  // 編集モードを開始
  const handleStartEdit = useCallback(
    (u: UnitRecord) => {
      if (!canUpdate) return;
      setEditingUnit(u);
      setCode(u.code);
      setName(u.name);
      setStatus(u.status || "active");
      setError("");
      setMessage("");
    },
    [canUpdate],
  );

  // フォーム送信 (Create または Update)。取引先マスタ(useCustomerForm.ts)と同じ4パターンの
  // 分岐(新規/変更 × 承認機能ON/OFF)を踏襲する。
  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();

    if (editingUnit && !canUpdate) return;
    if (!editingUnit && !canCreate) return;
    if (isSubmitting) return;

    setError("");
    setMessage("");
    setIsSubmitting(true);

    const finalCode = code.trim().toUpperCase();
    const finalName = name.trim();
    const payload = { code: finalCode, name: finalName };

    try {
      if (isUnitWfEnabled) {
        // 💡 承認機能有効時であっても、まずはマスタ本体へ「仮登録(temporary)」状態として
        // 先行して直接書き込み・更新を行う(取引先マスタと同じ二段階方式)
        const preSaveUrl = editingUnit
          ? `/api/units/${editingUnit.code}`
          : "/api/units/register";
        const preSaveMethod = editingUnit ? "PUT" : "POST";

        const preSavePayload = editingUnit
          ? {
              // 変更申請時は、変更後の値を本体に書き込んではいけない。
              // 変更前の状態を維持するため、ステータスだけを"temporary"(ロック)にして送信する。
              name: editingUnit.name,
              status: "temporary",
            }
          : { ...payload, status: "temporary" };

        await apiFetch(preSaveUrl, {
          method: preSaveMethod,
          json: preSavePayload,
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        // 最終承認時に反映させたいステータスを設定(新規登録の場合はactiveになるようにする)
        const workflowPayload = {
          ...payload,
          status: editingUnit ? status : "active",
        };

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_units",
            targetId: finalCode,
            requestType: editingUnit ? "UPDATE" : "REGISTER",
            payload: workflowPayload,
            applicantDepartmentSurrogateId,
            comment: editingUnit
              ? `単位マスタ[${finalCode}] 情報変更申請`
              : `単位マスタ[${finalCode}] 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });

        setMessage(
          editingUnit
            ? "マスタの変更承認をワークフローへ申請しました(承認待ちロック)"
            : "単位を仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        const targetUrl = editingUnit
          ? `/api/units/${editingUnit.code}`
          : "/api/units/register";
        const targetMethod = editingUnit ? "PUT" : "POST";

        await apiFetch(targetUrl, {
          method: targetMethod,
          json: editingUnit ? { ...payload, status } : payload,
          defaultErrorMessage: "処理に失敗しました",
        });

        setMessage(
          editingUnit ? "単位情報を更新しました" : "単位を新規登録しました",
        );
      }

      handleCancelEdit();
      await syncUnits();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 削除処理
  const handleDelete = async (u: UnitRecord) => {
    if (!canDelete || isSubmitting) return;

    if (
      !(await confirm(
        `単位 [${u.code}: ${u.name}] を削除しますか？\nすでにこの単位を使用している品目がある場合はエラーになります。`,
      ))
    ) {
      return;
    }

    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      await apiFetch(`/api/units/${u.code}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });

      setMessage("単位を削除しました");
      if (editingUnit?.code === u.code) handleCancelEdit();
      await syncUnits();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 無効化。取引先マスタ(handleSuspendCustomer)と同じく、承認機能有効時は直接無効化せず、
  // 承認申請(status=suspendedを最終ステータスとするUPDATE申請)を経由する。
  const handleSuspend = async (u: UnitRecord) => {
    if (!canDelete || isSubmitting) return;
    if (!(await confirm(`単位 [${u.code}: ${u.name}] を無効化しますか？`))) return;

    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      if (isUnitWfEnabled) {
        // 先行してマスタ本体をtemporary(審査中)にロックする
        await apiFetch(`/api/units/${u.code}`, {
          method: "PUT",
          json: { name: u.name, status: "temporary" },
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_units",
            targetId: u.code,
            requestType: "UPDATE",
            payload: { code: u.code, name: u.name, status: "suspended" },
            applicantDepartmentSurrogateId,
            comment: `単位マスタ[${u.code}] 無効化申請`,
          },
          defaultErrorMessage: "無効化の申請に失敗しました",
        });

        setMessage(
          "単位の無効化をワークフローへ申請しました(承認待ちロック)",
        );
      } else {
        await apiFetch(`/api/units/${u.code}/suspend`, {
          method: "POST",
          defaultErrorMessage: "無効化に失敗しました",
        });

        setMessage("単位を無効化しました");
      }

      if (editingUnit?.code === u.code) handleCancelEdit();
      await syncUnits();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    units,
    code,
    name,
    status,
    setStatus,
    isUnitCurrentlyLocked,
    editingUnit,
    message,
    error,
    isSubmitting: isSubmitting || importing,
    setCode,
    setName,
    filterStatus,
    setFilterStatus,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    handleDownloadCsv,
    handleImportCsv,
    handleSubmit,
    handleDelete,
    handleSuspend,
    handleStartEdit,
    handleCancelEdit,
    // ページネーション関連（3-0/3-3/3-4）
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  };
}
