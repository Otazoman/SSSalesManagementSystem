import { useState, useEffect } from "react";
import { WarehouseRecord, AttachmentRecord, WeekdayKey } from "../_types";
import { useAttachmentUpload } from "../../../_shared/hooks/use-attachment-upload";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import type { ApplicantDepartmentOption } from "../../../types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

// 1. 初期ステートを定数として集約
export const initialWarehouseFormState = {
  id: "",
  name: "",
  warehouseType: "INTERNAL" as "INTERNAL" | "EXTERNAL",
  postalCode: "",
  address: "",
  phoneNumber: "",
  faxNumber: "",
  email: "",
  businessStartTime: "",
  businessEndTime: "",
  storageRestrictions: "",
  status: "temporary",
  memo: "",
  availableDays: {
    MON: { checked: false, memo: "" },
    TUE: { checked: false, memo: "" },
    WED: { checked: false, memo: "" },
    THU: { checked: false, memo: "" },
    FRI: { checked: false, memo: "" },
    SAT: { checked: false, memo: "" },
    SUN: { checked: false, memo: "" },
  } as Record<string, { checked: boolean; memo: string }>,
  attachments: [] as AttachmentRecord[],
};

interface UseWarehouseFormProps {
  canCreate: boolean;
  canUpdate: boolean;
  isWarehouseWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  onClose?: () => void;
}

export function useWarehouseForm({
  canCreate,
  canUpdate,
  isWarehouseWfEnabled = false,
  departments = [],
  onSuccess,
  onError,
  onClose,
}: UseWarehouseFormProps) {
  const confirm = useConfirm();
  // 追加要望F: 複数部門所属時の申請部門選択(初期値は所属部門の先頭=従来の暗黙動作と同じ)。
  // departmentsはusePagePermissions()から非同期に取得されるため、useState初期値だけでは
  // 反映されない場合がある。ロード完了後にuseEffectで未選択(null)の場合のみ先頭部門を
  // 補完する(ユーザーが既に選択した値は上書きしない)。
  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] =
    useState<string | null>(null);
  useEffect(() => {
    if (applicantDepartmentSurrogateId === null && departments.length > 0) {
      setApplicantDepartmentSurrogateId(departments[0].surrogateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(initialWarehouseFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [extUrlInput, setExtUrlInput] = useState("");
  const [extNameInput, setExtNameInput] = useState("");
  const [wfStatus, setWfStatus] = useState<string | null>(null);
  const { uploading, uploadFile } = useAttachmentUpload({
    uploadUrl: "/api/warehouses/upload",
    onError,
  });

  // 💡 取引先マスタ等と同じロック機構: 編集中の倉庫が承認ワークフロー審査中(PENDING)なら、
  // フォームを完全ロックする(上書き・再編集防止)
  const isWarehouseCurrentlyLocked =
    !!editingId &&
    isWarehouseWfEnabled &&
    formData.status === "temporary" &&
    wfStatus === "PENDING";

  useEffect(() => {
    if (!editingId || !isWarehouseWfEnabled) {
      setWfStatus(null);
      return;
    }
    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingId}?targetType=master_warehouses`,
        );
        setWfStatus(data.status);
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };
    void fetchWfStatus();
  }, [editingId, isWarehouseWfEnabled, formData.status]);

  // フィールド更新汎用ハンドラー（取引先形式）
  const handleInputChange = (
    field: keyof typeof initialWarehouseFormState,
    value: any,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // フォーム初期化 ＆ クローズ処理
  const handleCloseForm = () => {
    setFormData(initialWarehouseFormState);
    setEditingId(null);
    setEditingRecord(null);
    setWfStatus(null);
    setExtUrlInput("");
    setExtNameInput("");
    if (onClose) onClose();
  };

  // 編集用データセット
  const [editingRecord, setEditingRecord] = useState<WarehouseRecord | null>(
    null,
  );
  const selectWarehouseForEdit = (w: WarehouseRecord) => {
    setEditingId(w.id);
    setEditingRecord(w);

    const initialDays: Record<string, { checked: boolean; memo: string }> = {
      MON: { checked: false, memo: "" },
      TUE: { checked: false, memo: "" },
      WED: { checked: false, memo: "" },
      THU: { checked: false, memo: "" },
      FRI: { checked: false, memo: "" },
      SAT: { checked: false, memo: "" },
      SUN: { checked: false, memo: "" },
    };

    w.availableDays?.forEach((day) => {
      if (initialDays[day.availabledayOfWeek]) {
        initialDays[day.availabledayOfWeek] = {
          checked: true,
          memo: day.timeSlotMemo || "",
        };
      }
    });

    setFormData({
      id: w.id,
      name: w.name,
      warehouseType: w.warehouseType || "INTERNAL",
      postalCode: w.postalCode || "",
      address: w.address || "",
      phoneNumber: w.phoneNumber || "",
      faxNumber: w.faxNumber || "",
      email: w.email || "",
      businessStartTime: w.businessStartTime || "",
      businessEndTime: w.businessEndTime || "",
      storageRestrictions: w.storageRestrictions || "",
      status: w.status,
      memo: w.memo || "",
      availableDays: initialDays,
      attachments: w.attachments || [],
    });
  };

  // 受付曜日チェック変更
  const handleDayCheckChange = (dayKey: string, checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      availableDays: {
        ...prev.availableDays,
        [dayKey]: { ...prev.availableDays[dayKey], checked },
      },
    }));
  };

  // 受付曜日メモ変更
  const handleDayMemoChange = (dayKey: string, memo: string) => {
    setFormData((prev) => ({
      ...prev,
      availableDays: {
        ...prev.availableDays,
        [dayKey]: { ...prev.availableDays[dayKey], memo },
      },
    }));
  };

  // ファイルアップロード
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    onError("");
    const attachment = await uploadFile(e, "OTHER");
    if (!attachment) return;
    setFormData((prev) => ({
      ...prev,
      attachments: [...prev.attachments, attachment],
    }));
  };

  // 外部リンク追加
  const handleAddExternalLink = () => {
    if (!extUrlInput.trim() || !extNameInput.trim()) return;
    let url = extUrlInput.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    setFormData((prev) => ({
      ...prev,
      attachments: [
        ...prev.attachments,
        {
          fileName: extNameInput.trim(),
          storageType: "EXTERNAL_LINK",
          externalUrl: url,
          fileType: "OTHER",
        },
      ],
    }));
    setExtUrlInput("");
    setExtNameInput("");
  };

  // 添付ファイル削除
  const handleRemoveAttachment = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index),
    }));
  };

  // 送信処理
  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (editingId && !canUpdate) return;
    if (!editingId && !canCreate) return;
    if (isSubmitting) return;

    onError("");
    onSuccess("");
    setIsSubmitting(true);

    const formattedAvailableDays = Object.entries(formData.availableDays)
      .filter(([_, value]) => value.checked)
      .map(([key, value]) => ({
        availabledayOfWeek: key as WeekdayKey,
        timeSlotMemo: value.memo || null,
      }));

    const payload = {
      id: formData.id,
      name: formData.name,
      warehouseType: formData.warehouseType,
      postalCode: formData.postalCode || null,
      address: formData.address || null,
      phoneNumber: formData.phoneNumber || null,
      faxNumber: formData.faxNumber || null,
      email: formData.email || null,
      businessStartTime: formData.businessStartTime || null,
      businessEndTime: formData.businessEndTime || null,
      storageRestrictions: formData.storageRestrictions || null,
      status: formData.status,
      memo: formData.memo || null,
      availableDays: formattedAvailableDays,
      attachments: formData.attachments,
    };

    try {
      if (isWarehouseWfEnabled) {
        // 💡 承認機能有効時は、まずマスタ本体へ「仮登録(temporary)」状態として
        // 先行して直接書き込み・更新を行う(取引先・単位等と同じ二段階方式)。
        // 変更申請時は変更後の値を本体に書き込んではいけないため、既存レコードの値を
        // そのまま使い、statusだけをtemporary(ロック)にして送信する。
        let registerResult: { id?: string } | undefined;
        if (editingId) {
          const preSavePayload = {
            id: editingId,
            name: editingRecord?.name ?? payload.name,
            warehouseType: editingRecord?.warehouseType ?? "INTERNAL",
            postalCode: editingRecord?.postalCode ?? null,
            address: editingRecord?.address ?? null,
            phoneNumber: editingRecord?.phoneNumber ?? null,
            faxNumber: editingRecord?.faxNumber ?? null,
            email: editingRecord?.email ?? null,
            businessStartTime: editingRecord?.businessStartTime ?? null,
            businessEndTime: editingRecord?.businessEndTime ?? null,
            storageRestrictions: editingRecord?.storageRestrictions ?? null,
            memo: editingRecord?.memo ?? null,
            availableDays:
              editingRecord?.availableDays?.map((d) => ({
                availabledayOfWeek: d.availabledayOfWeek,
                timeSlotMemo: d.timeSlotMemo || null,
              })) || [],
            attachments: editingRecord?.attachments || [],
            status: "temporary" as const,
          };
          await apiFetch(`/api/warehouses/${editingId}`, {
            method: "PUT",
            json: preSavePayload,
            defaultErrorMessage:
              "マスタ本体への一時保存(仮登録)に失敗しました",
          });
        } else {
          registerResult = await apiFetch<{ id?: string }>("/api/warehouses/register", {
            method: "POST",
            json: payload,
            defaultErrorMessage:
              "マスタ本体への一時保存(仮登録)に失敗しました",
          });
        }

        // マスタコード自動採番: formData.idが空欄(自動採番依頼)の場合、pre-save応答で
        // サーバーが確定させたIDを使う(空欄のままだとワークフロー申請のtargetIdが空になってしまう)
        const targetId = editingId || registerResult?.id || formData.id;
        const workflowPayload = {
          ...payload,
          id: targetId,
          status: editingId ? formData.status : "active",
        };

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_warehouses",
            targetId,
            requestType: editingId ? "UPDATE" : "REGISTER",
            payload: workflowPayload,
            applicantDepartmentSurrogateId,
            comment: editingId
              ? `倉庫[${targetId}] 情報変更申請`
              : `倉庫 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });

        onSuccess(
          editingId
            ? "倉庫の変更承認をワークフローへ申請しました(承認待ちロック)"
            : "倉庫を仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        const url = editingId
          ? `/api/warehouses/${editingId}`
          : "/api/warehouses/register";
        await apiFetch(url, {
          method: editingId ? "PUT" : "POST",
          json: payload,
        });

        onSuccess(
          editingId
            ? "倉庫情報および受付可能日を更新しました"
            : "倉庫情報を新規登録しました",
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

  // 無効化。取引先・単位等と同じく、承認機能有効時は直接無効化せず承認申請を経由する。
  const handleSuspend = async (w: WarehouseRecord) => {
    if (!canUpdate || isSubmitting) return;
    if (!(await confirm(`倉庫[${w.id}: ${w.name}]を無効化しますか？`))) return;

    onError("");
    onSuccess("");
    setIsSubmitting(true);

    const availableDaysPayload =
      w.availableDays?.map((d) => ({
        availabledayOfWeek: d.availabledayOfWeek,
        timeSlotMemo: d.timeSlotMemo || null,
      })) || [];

    try {
      if (isWarehouseWfEnabled) {
        await apiFetch(`/api/warehouses/${w.id}`, {
          method: "PUT",
          json: {
            id: w.id,
            name: w.name,
            warehouseType: w.warehouseType,
            postalCode: w.postalCode,
            address: w.address,
            phoneNumber: w.phoneNumber,
            faxNumber: w.faxNumber,
            email: w.email,
            businessStartTime: w.businessStartTime,
            businessEndTime: w.businessEndTime,
            storageRestrictions: w.storageRestrictions,
            memo: w.memo,
            availableDays: availableDaysPayload,
            attachments: w.attachments || [],
            status: "temporary",
          },
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_warehouses",
            targetId: w.id,
            requestType: "UPDATE",
            payload: {
              name: w.name,
              warehouseType: w.warehouseType,
              postalCode: w.postalCode,
              address: w.address,
              phoneNumber: w.phoneNumber,
              faxNumber: w.faxNumber,
              email: w.email,
              businessStartTime: w.businessStartTime,
              businessEndTime: w.businessEndTime,
              storageRestrictions: w.storageRestrictions,
              memo: w.memo,
              availableDays: availableDaysPayload,
              attachments: w.attachments || [],
              status: "suspended",
            },
            applicantDepartmentSurrogateId,
            comment: `倉庫[${w.id}] 無効化申請`,
          },
          defaultErrorMessage: "無効化の申請に失敗しました",
        });

        onSuccess("倉庫の無効化をワークフローへ申請しました(承認待ちロック)");
      } else {
        await apiFetch(`/api/warehouses/${w.id}/suspend`, {
          method: "POST",
          defaultErrorMessage: "無効化に失敗しました",
        });
        onSuccess("倉庫を無効化しました");
      }

      if (editingId === w.id) handleCloseForm();
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
    isWarehouseCurrentlyLocked,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    extUrlInput,
    setExtUrlInput,
    extNameInput,
    setExtNameInput,
    uploading,
    handleInputChange,
    handleCloseForm,
    selectWarehouseForEdit,
    handleDayCheckChange,
    handleDayMemoChange,
    handleFileUpload,
    handleAddExternalLink,
    handleRemoveAttachment,
    handleSubmit,
    handleSuspend,
  };
}
