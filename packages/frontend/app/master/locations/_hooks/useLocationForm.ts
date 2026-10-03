import { useState, useEffect } from "react";
import { LocationRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import type { ApplicantDepartmentOption } from "../../../types";

interface UseLocationFormProps {
  canCreate: boolean;
  canUpdate: boolean;
  isLocationWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function useLocationForm({
  canCreate,
  canUpdate,
  isLocationWfEnabled = false,
  departments = [],
  onSuccess,
  onError,
}: UseLocationFormProps) {
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [locId, setLocId] = useState("");
  const [locWarehouseId, setLocWarehouseId] = useState("");
  const [locName, setLocName] = useState("");
  const [locMemo, setLocMemo] = useState("");
  const [locStatus, setLocStatus] = useState(
    isLocationWfEnabled ? "temporary" : "active",
  );
  const [wfStatus, setWfStatus] = useState<string | null>(null);

  // 💡 取引先マスタと同じロック機構: 編集中のロケーションが承認ワークフロー審査中(PENDING)なら、
  // フォームを完全ロックする(上書き・再編集防止)
  const isLocationCurrentlyLocked =
    !!editingId &&
    isLocationWfEnabled &&
    locStatus === "temporary" &&
    wfStatus === "PENDING";

  useEffect(() => {
    if (!editingId || !isLocationWfEnabled) {
      setWfStatus(null);
      return;
    }

    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingId}?targetType=master_locations`,
        );
        setWfStatus(data.status);
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };

    void fetchWfStatus();
  }, [editingId, isLocationWfEnabled, locStatus]);

  const resetForm = () => {
    setLocId("");
    setLocWarehouseId("");
    setLocName("");
    setLocMemo("");
    setLocStatus(isLocationWfEnabled ? "temporary" : "active");
    setWfStatus(null);
  };

  const selectLocationForEdit = (l: LocationRecord) => {
    setEditingId(l.id);
    setLocId(l.id);
    setLocWarehouseId(l.warehouseId);
    setLocName(l.name);
    setLocMemo(l.memo || "");
    setLocStatus(l.status || "active");
  };

  // 取引先マスタ(useCustomerForm.ts)と同じ4パターンの分岐(新規/変更 × 承認機能ON/OFF)を踏襲する。
  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    onError("");
    onSuccess("");

    // 権限のセーフティガード
    if (!editingId && !canCreate) {
      onError("登録する権限がありません");
      return false;
    }
    if (editingId && !canUpdate) {
      onError("更新する権限がありません");
      return false;
    }

    const payload = {
      id: locId,
      warehouseId: locWarehouseId,
      name: locName,
      memo: locMemo || null,
    };

    try {
      if (isLocationWfEnabled) {
        // 💡 承認機能有効時であっても、まずはマスタ本体へ「仮登録(temporary)」状態として
        // 先行して直接書き込み・更新を行う(取引先マスタと同じ二段階方式)
        const preSaveUrl = editingId
          ? `/api/locations/${editingId}`
          : "/api/locations/register";
        const preSaveMethod = editingId ? "PUT" : "POST";

        const preSavePayload = editingId
          ? {
              // 変更申請時は、変更後の値を本体に書き込んではいけない。
              // 変更前の状態を維持するため、ステータスだけを"temporary"(ロック)にして送信する。
              warehouseId: locWarehouseId,
              name: locName,
              memo: locMemo || null,
              status: "temporary",
            }
          : { ...payload, status: "temporary" };

        await apiFetch(preSaveUrl, {
          method: preSaveMethod,
          json: preSavePayload,
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        const workflowPayload = {
          ...payload,
          status: editingId ? locStatus : "active",
        };

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_locations",
            targetId: locId,
            requestType: editingId ? "UPDATE" : "REGISTER",
            payload: workflowPayload,
            applicantDepartmentSurrogateId,
            comment: editingId
              ? `ロケーションマスタ[${locId}] 情報変更申請`
              : `ロケーションマスタ[${locId}] 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });

        onSuccess(
          editingId
            ? "マスタの変更承認をワークフローへ申請しました(承認待ちロック)"
            : "ロケーションを仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        const url = editingId
          ? `/api/locations/${editingId}`
          : "/api/locations/register";

        await apiFetch(url, {
          method: editingId ? "PUT" : "POST",
          json: editingId ? { ...payload, status: locStatus } : payload,
        });

        onSuccess(
          editingId
            ? "ロケーション情報を更新しました"
            : "ロケーションを新規登録しました",
        );
      }

      resetForm();
      setEditingId(null);
      return true; // 成功
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "予期せぬエラーが発生しました",
      );
      return false; // 失敗
    }
  };

  return {
    editingId,
    setEditingId,
    locId,
    setLocId,
    locWarehouseId,
    setLocWarehouseId,
    locName,
    setLocName,
    locMemo,
    setLocMemo,
    locStatus,
    setLocStatus,
    isLocationCurrentlyLocked,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    resetForm,
    selectLocationForEdit,
    handleSubmit,
  };
}
