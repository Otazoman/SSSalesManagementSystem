import { useState, useCallback, useEffect } from "react";
import {
  ApprovalFlowRecord,
  RoleRecord,
  ScreenRecord,
  DepartmentOption,
  BuilderStep,
} from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UseApprovalFlowProps {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  loadingPermissions: boolean;
}

export function useApprovalFlow({
  canRead,
  canCreate,
  canUpdate,
  loadingPermissions,
}: UseApprovalFlowProps) {
  const confirm = useConfirm();
  const [flows, setFlows] = useState<ApprovalFlowRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [screens, setScreens] = useState<ScreenRecord[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<
    DepartmentOption[]
  >([]);
  const [filterStatus, setFilterStatus] = useState<
    "all" | "active" | "inactive"
  >("active");

  // ヘッダクリックソート(追加要望D)。filterStatusと同じくクライアント側フィルタの前段でサーバーに並び替えを依頼する。
  // 追加要望J-1-a(複合ソート): Shift+クリック(additive)で複数キーを追加できるよう、
  // `_shared/hooks/use-paginated-list.ts`と同じ設計(キー配列)に合わせる
  const [sortKeys, setSortKeys] = useState<{ key: string; direction: "asc" | "desc" }[]>([]);
  const setSort = useCallback((key: string, additive = false) => {
    setSortKeys((prev) => {
      if (additive) {
        const index = prev.findIndex((s) => s.key === key);
        if (index === -1) return [...prev, { key, direction: "asc" }];
        return prev.map((s, i) =>
          i === index ? { key, direction: s.direction === "asc" ? "desc" : "asc" } : s,
        );
      }
      const isOnlyKey = prev.length === 1 && prev[0].key === key;
      return isOnlyKey
        ? [{ key, direction: prev[0].direction === "asc" ? "desc" : "asc" }]
        : [{ key, direction: "asc" }];
    });
  }, []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [flowName, setFlowName] = useState("");
  const [requestType, setRequestType] = useState("");
  const [minAmount, setMinAmount] = useState("0");
  const [maxAmount, setMaxAmount] = useState("999999999");
  const [matchField, setMatchField] = useState("");
  const [matchValue, setMatchValue] = useState("");

  const [builderSteps, setBuilderSteps] = useState<BuilderStep[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedDepartmentSurrogateId, setSelectedDepartmentSurrogateId] =
    useState<string | null>(null);
  const [stepName, setStepName] = useState("");
  const [stepMemo, setStepMemo] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 一覧はfilterStatusで絞り込むのではなくクライアント側でフィルタする既存設計のため、
  // usePaginatedListは使わず（サーバー側pagination総数とクライアント側フィルタ後件数が
  // 食い違うのを避けるため）、既存通りapiFetchで全件取得する。
  const syncFlowsAndRoles = useCallback(async () => {
    try {
      const flowsParams = new URLSearchParams();
      if (sortKeys.length > 0) {
        flowsParams.set("sortBy", sortKeys.map((s) => s.key).join(","));
        flowsParams.set("sortOrder", sortKeys.map((s) => s.direction).join(","));
      }
      const [flowsData, rolesData, allScreens, deptsData] = await Promise.all(
        [
          apiFetch<ApprovalFlowRecord[]>(
            `/api/approval-flows?${flowsParams.toString()}`,
          ).catch(() => []),
          apiFetch<RoleRecord[]>("/api/roles").catch(() => []),
          apiFetch<any[]>("/api/permissions/screens").catch(() => []),
          apiFetch<DepartmentOption[]>(
            "/api/departments?filter=active_and_future",
          ).catch(() => []),
        ],
      );

      setFlows(Array.isArray(flowsData) ? flowsData : []);

      if (Array.isArray(rolesData)) {
        setRoles(rolesData);
        if (rolesData.length > 0) setSelectedRoleId(rolesData[0].id);
      }

      const filtered = (allScreens || []).filter(
        (s: any) =>
          s.category === "daily_work" || s.category === "business_master",
      );
      setScreens(filtered);

      setDepartmentOptions(Array.isArray(deptsData) ? deptsData : []);
    } catch (err) {
      console.error("マスタデータの同期に失敗しました:", err);
    }
  }, [sortKeys]);

  useEffect(() => {
    if (!loadingPermissions && canRead) {
      void syncFlowsAndRoles();
    }
  }, [loadingPermissions, canRead, syncFlowsAndRoles]);

  const addStepToBuilder = () => {
    if (!canCreate && !canUpdate) return;
    if (!selectedRoleId) return;
    setBuilderSteps([
      ...builderSteps,
      {
        approverRoleId: selectedRoleId,
        targetDepartmentSurrogateId: selectedDepartmentSurrogateId,
        stepName: stepName,
        memo: stepMemo,
      },
    ]);
    setStepMemo("");
    setStepName("");
    setSelectedDepartmentSurrogateId(null);
  };

  const removeStepFromBuilder = (idx: number) => {
    if (!canCreate && !canUpdate) return;
    setBuilderSteps(builderSteps.filter((_, i) => i !== idx));
  };

  const handleEditClick = (flow: ApprovalFlowRecord) => {
    if (!canUpdate) {
      setError("⚠️ あなたのロールには、このマスタを変更する権限がありません");
      return;
    }
    setEditingFlowId(flow.id);
    setFlowName(flow.name);
    setRequestType(flow.requestType);
    setMinAmount(String(flow.minAmount));
    setMaxAmount(String(flow.maxAmount));
    setMatchField(flow.matchField || "");
    setMatchValue(flow.matchValue || "");
    setBuilderSteps(
      flow.steps.map((s) => ({
        approverRoleId: s.approverRoleId,
        targetDepartmentSurrogateId: s.targetDepartmentSurrogateId || null,
        stepName: s.stepName || "",
        memo: s.memo || "",
      })),
    );
    setMessage(`「${flow.name}」の編集モードに入りました`);
    setError("");
  };

  // 💡 message はここでクリアしない: handleSubmitFlow/handleDisableFlow/handlePurgeFlowが
  // 成功メッセージをsetMessage()した直後にこの関数を呼ぶため、ここでクリアすると
  // 同期的なstate更新により成功メッセージが即座に空文字で上書きされてしまう。
  // 手動キャンセル時のメッセージクリアは呼び出し側(page.tsxのhandleCloseForm)で行う。
  const handleCancelEdit = () => {
    setEditingFlowId(null);
    setFlowName("");
    setRequestType("");
    setBuilderSteps([]);
    setMinAmount("0");
    setMaxAmount("999999999");
    setMatchField("");
    setMatchValue("");
    setError("");
    setSelectedDepartmentSurrogateId(null);
  };

  const { download } = useCsvDownload({
    fileNamePrefix: "approval_flows_export",
    onError: () => setError("CSVダウンロードに失敗しました"),
  });
  const handleCsvDownload = async () => {
    if (!canRead || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await download("/api/approval-flows/csv-download");
    } finally {
      setIsSubmitting(false);
    }
  };

  const { importCsv } = useCsvImport({
    onSuccess: syncFlowsAndRoles,
    onMessage: setMessage,
    onError: setError,
  });
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canCreate || isSubmitting) return;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await importCsv("/api/approval-flows/bulk-register", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitFlow = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (editingFlowId && !canUpdate) {
      setError("この定義を変更する権限がありません");
      return;
    }
    if (!editingFlowId && !canCreate) {
      setError("新規に承認フローを追加する権限がありません");
      return;
    }

    if (builderSteps.length === 0) {
      setError("少なくとも1段階以上の承認ステップを組み立ててください");
      return;
    }

    if ((matchField.trim() === "") !== (matchValue.trim() === "")) {
      setError(
        "詳細マッチ条件は「対象フィールド」「期待値」の両方を入力するか、両方とも空欄にしてください",
      );
      return;
    }

    setIsSubmitting(true);
    const url = editingFlowId
      ? `/api/approval-flows/${editingFlowId}`
      : "/api/approval-flows/register";
    const method = editingFlowId ? "PUT" : "POST";

    try {
      await apiFetch(url, {
        method,
        json: {
          name: flowName,
          requestType,
          minAmount: Number(minAmount),
          maxAmount: Number(maxAmount),
          matchField: matchField.trim() || null,
          matchValue: matchValue.trim() || null,
          steps: builderSteps,
        },
        defaultErrorMessage: "処理に失敗しました",
      });
      setMessage(
        editingFlowId
          ? "承認フロー設定を上書き更新しました"
          : "動的承認ルート定義をマスタへ反映しました",
      );
      handleCancelEdit();
      void syncFlowsAndRoles();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "サーバー処理中にエラーが発生しました",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisableFlow = async (id: string, name: string) => {
    if (!canUpdate || isSubmitting) return;
    if (!(await confirm(`本当に「${name}」を無効化しますか？`))) return;
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/approval-flows/${id}/suspend`, { method: "POST" });
      setMessage("承認フロー設定を無効化しました");
      if (editingFlowId === id) handleCancelEdit();
      void syncFlowsAndRoles();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestoreFlow = async (flow: ApprovalFlowRecord) => {
    if (!canUpdate || isSubmitting) return;
    if (!(await confirm(`「${flow.name}」を再度有効に戻しますか？`))) return;
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/approval-flows/${flow.id}`, {
        method: "PUT",
        json: {
          name: flow.name,
          requestType: flow.requestType,
          minAmount: flow.minAmount,
          maxAmount: flow.maxAmount,
          matchField: flow.matchField || null,
          matchValue: flow.matchValue || null,
          steps: flow.steps.map((s) => ({
            approverRoleId: s.approverRoleId,
            targetDepartmentSurrogateId: s.targetDepartmentSurrogateId || null,
            stepName: s.stepName || "",
            memo: s.memo || "",
          })),
          isActive: true,
        },
        defaultErrorMessage: "復元処理に失敗しました",
      });

      setMessage(`「${flow.name}」を再度有効化(復元)しました`);
      setError("");
      await syncFlowsAndRoles();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePurgeFlow = async (id: string, name: string) => {
    if (!canUpdate || isSubmitting) return;
    if (
      !(await confirm(
        `【警告】承認フロー「${name}」の全構成データを完全にDBから消去しますか？`,
      ))
    )
      return;
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/approval-flows/${id}/purge`, {
        method: "DELETE",
        defaultErrorMessage: "完全消去に失敗しました",
      });
      setMessage("承認フロー設定を完全に消去しました");
      if (editingFlowId === id) handleCancelEdit();
      void syncFlowsAndRoles();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredFlows = flows.filter((f) => {
    if (filterStatus === "active") return f.isActive === true;
    if (filterStatus === "inactive") return f.isActive === false;
    return true;
  });

  return {
    flows,
    roles,
    screens,
    departmentOptions,
    filterStatus,
    setFilterStatus,
    sortBy: sortKeys[0]?.key ?? null,
    sortDirection: sortKeys[0]?.direction ?? "asc",
    sortKeys,
    setSort,
    filteredFlows,
    isSubmitting,
    editingFlowId,
    flowName,
    setFlowName,
    requestType,
    setRequestType,
    minAmount,
    setMinAmount,
    maxAmount,
    setMaxAmount,
    matchField,
    setMatchField,
    matchValue,
    setMatchValue,
    builderSteps,
    selectedRoleId,
    setSelectedRoleId,
    selectedDepartmentSurrogateId,
    setSelectedDepartmentSurrogateId,
    stepName,
    setStepName,
    stepMemo,
    setStepMemo,
    message,
    setMessage,
    error,
    setError,
    addStepToBuilder,
    removeStepFromBuilder,
    handleEditClick,
    handleCancelEdit,
    handleCsvDownload,
    handleCsvImport,
    handleSubmitFlow,
    handleDisableFlow,
    handleRestoreFlow,
    handlePurgeFlow,
  };
}
