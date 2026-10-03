import { useState, useEffect } from "react";
import { BusinessLocationRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import type { ApplicantDepartmentOption } from "../../../types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

// 営業拠点マスタ(2026-09-23新設)。倉庫マスタ(useWarehouseForm)から添付ファイル・受付可能日・
// FAX・メール・営業時間を除いた簡素な項目構成。承認ワークフロー・二段階申請の方式は同じ。
export const initialBusinessLocationFormState = {
  id: "",
  name: "",
  postalCode: "",
  address: "",
  phoneNumber: "",
  status: "temporary",
  memo: "",
};

interface UseBusinessLocationFormProps {
  canCreate: boolean;
  canUpdate: boolean;
  isBusinessLocationWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  onClose?: () => void;
}

export function useBusinessLocationForm({
  canCreate,
  canUpdate,
  isBusinessLocationWfEnabled = false,
  departments = [],
  onSuccess,
  onError,
  onClose,
}: UseBusinessLocationFormProps) {
  const confirm = useConfirm();
  // 追加要望F: 複数部門所属時の申請部門選択(初期値は所属部門の先頭)。departmentsは
  // usePagePermissions()から非同期に取得されるため、useEffectで未選択(null)の場合のみ補完する。
  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] =
    useState<string | null>(null);
  useEffect(() => {
    if (applicantDepartmentSurrogateId === null && departments.length > 0) {
      setApplicantDepartmentSurrogateId(departments[0].surrogateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialBusinessLocationFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [wfStatus, setWfStatus] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] =
    useState<BusinessLocationRecord | null>(null);

  // 取引先・倉庫マスタ等と同じロック機構: 編集中の拠点が承認ワークフロー審査中(PENDING)なら、
  // フォームを完全ロックする(上書き・再編集防止)
  const isBusinessLocationCurrentlyLocked =
    !!editingId &&
    isBusinessLocationWfEnabled &&
    formData.status === "temporary" &&
    wfStatus === "PENDING";

  useEffect(() => {
    if (!editingId || !isBusinessLocationWfEnabled) {
      setWfStatus(null);
      return;
    }
    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingId}?targetType=master_business_locations`,
        );
        setWfStatus(data.status);
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };
    void fetchWfStatus();
  }, [editingId, isBusinessLocationWfEnabled, formData.status]);

  const handleInputChange = (
    field: keyof typeof initialBusinessLocationFormState,
    value: string,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCloseForm = () => {
    setFormData(initialBusinessLocationFormState);
    setEditingId(null);
    setEditingRecord(null);
    setWfStatus(null);
    if (onClose) onClose();
  };

  const selectBusinessLocationForEdit = (loc: BusinessLocationRecord) => {
    setEditingId(loc.id);
    setEditingRecord(loc);
    setFormData({
      id: loc.id,
      name: loc.name,
      postalCode: loc.postalCode || "",
      address: loc.address || "",
      phoneNumber: loc.phoneNumber || "",
      status: loc.status,
      memo: loc.memo || "",
    });
  };

  const buildPayload = (overrides: Partial<typeof formData> = {}) => {
    const merged = { ...formData, ...overrides };
    return {
      id: merged.id,
      name: merged.name,
      postalCode: merged.postalCode || null,
      address: merged.address || null,
      phoneNumber: merged.phoneNumber || null,
      status: merged.status,
      memo: merged.memo || null,
    };
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (editingId && !canUpdate) return;
    if (!editingId && !canCreate) return;
    if (isSubmitting) return;

    onError("");
    onSuccess("");
    setIsSubmitting(true);

    const payload = buildPayload();

    try {
      if (isBusinessLocationWfEnabled) {
        // 承認機能有効時は、まずマスタ本体へ「仮登録(temporary)」状態として先行して
        // 直接書き込み・更新を行う(取引先・倉庫等と同じ二段階方式)。変更申請時は変更後の値を
        // 本体に書き込んではいけないため、既存レコードの値をそのまま使いstatusだけロックする。
        let registerResult: { id?: string } | undefined;
        if (editingId) {
          await apiFetch(`/api/business-locations/${editingId}`, {
            method: "PUT",
            json: {
              id: editingId,
              name: editingRecord?.name ?? payload.name,
              postalCode: editingRecord?.postalCode ?? null,
              address: editingRecord?.address ?? null,
              phoneNumber: editingRecord?.phoneNumber ?? null,
              memo: editingRecord?.memo ?? null,
              status: "temporary" as const,
            },
            defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
          });
        } else {
          registerResult = await apiFetch<{ id?: string }>(
            "/api/business-locations/register",
            {
              method: "POST",
              json: payload,
              defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
            },
          );
        }

        // マスタコード自動採番: formData.idが空欄(自動採番依頼)の場合、pre-save応答で
        // サーバーが確定させたIDを使う
        const targetId = editingId || registerResult?.id || formData.id;
        const workflowPayload = {
          ...payload,
          id: targetId,
          status: editingId ? formData.status : "active",
        };

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_business_locations",
            targetId,
            requestType: editingId ? "UPDATE" : "REGISTER",
            payload: workflowPayload,
            applicantDepartmentSurrogateId,
            comment: editingId
              ? `営業拠点[${targetId}] 情報変更申請`
              : `営業拠点 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });

        onSuccess(
          editingId
            ? "営業拠点の変更承認をワークフローへ申請しました(承認待ちロック)"
            : "営業拠点を仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        const url = editingId
          ? `/api/business-locations/${editingId}`
          : "/api/business-locations/register";
        await apiFetch(url, {
          method: editingId ? "PUT" : "POST",
          json: payload,
        });

        onSuccess(
          editingId ? "営業拠点情報を更新しました" : "営業拠点情報を新規登録しました",
        );
      }

      handleCloseForm();
      return true;
    } catch (err: any) {
      onError(err.message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  // 無効化。取引先・倉庫等と同じく、承認機能有効時は直接無効化せず承認申請を経由する。
  const handleSuspend = async (loc: BusinessLocationRecord) => {
    if (!canUpdate || isSubmitting) return;
    if (!(await confirm(`営業拠点[${loc.id}: ${loc.name}]を無効化しますか？`))) return;

    onError("");
    onSuccess("");
    setIsSubmitting(true);

    try {
      if (isBusinessLocationWfEnabled) {
        await apiFetch(`/api/business-locations/${loc.id}`, {
          method: "PUT",
          json: {
            id: loc.id,
            name: loc.name,
            postalCode: loc.postalCode,
            address: loc.address,
            phoneNumber: loc.phoneNumber,
            memo: loc.memo,
            status: "temporary",
          },
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_business_locations",
            targetId: loc.id,
            requestType: "UPDATE",
            payload: {
              name: loc.name,
              postalCode: loc.postalCode,
              address: loc.address,
              phoneNumber: loc.phoneNumber,
              memo: loc.memo,
              status: "suspended",
            },
            applicantDepartmentSurrogateId,
            comment: `営業拠点[${loc.id}] 無効化申請`,
          },
          defaultErrorMessage: "無効化の申請に失敗しました",
        });

        onSuccess("営業拠点の無効化をワークフローへ申請しました(承認待ちロック)");
      } else {
        await apiFetch(`/api/business-locations/${loc.id}/suspend`, {
          method: "POST",
          defaultErrorMessage: "無効化に失敗しました",
        });
        onSuccess("営業拠点を無効化しました");
      }

      if (editingId === loc.id) handleCloseForm();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    editingId,
    setEditingId,
    formData,
    setFormData,
    isSubmitting,
    isBusinessLocationCurrentlyLocked,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    handleInputChange,
    handleCloseForm,
    selectBusinessLocationForEdit,
    handleSubmit,
    handleSuspend,
  };
}
