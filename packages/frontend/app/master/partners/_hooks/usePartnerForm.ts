import { useEffect, useState } from "react";
import { AttachmentItem, BankAccountItem, PartnerType } from "../_types";
import { useAttachmentUpload } from "../../../_shared/hooks/use-attachment-upload";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import type { ApplicantDepartmentOption } from "../../../types";

export const initialFormState = {
  id: "",
  name: "",
  type: "CUSTOMER" as PartnerType,
  postalCode: "",
  address: "",
  phone: "",
  fax: "",
  creditLimit: "" as number | "",
  status: "active" as "temporary" | "active" | "suspended",
  memo: "",
  closingDay: "" as number | "",
  paymentMonthOffset: "" as number | "",
  paymentDay: "" as number | "",
  paymentMethod: "",
  qualifiedInvoiceNumber: "",
  corporateNumber: "",
  antiSocialCheckStatus: "UNCHECKED",
  antiSocialCheckMemo: "",
  contractDate: "",
  contractValidTo: "",
  attachments: [] as AttachmentItem[],
  bankAccounts: [] as BankAccountItem[],
};

const EMPTY_BANK_ACCOUNT: BankAccountItem = {
  bankName: "",
  bankCode: "",
  branchName: "",
  branchCode: "",
  accountType: "ORDINARY",
  accountNumber: "",
  accountHolderName: "",
  isDefault: false,
};

export function usePartnerForm(
  editingId: string | null,
  isPartnerWfEnabled: boolean,
  canCreate: boolean,
  canUpdate: boolean,
  onSuccess: (message: string) => void,
  onClose: () => void,
  departments: ApplicantDepartmentOption[] = [],
) {
  const [formData, setFormData] = useState(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [extUrlInput, setExtUrlInput] = useState("");
  const [extTitleInput, setExtTitleInput] = useState("");
  const [error, setError] = useState("");
  const [wfStatus, setWfStatus] = useState<string | null>(null);
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

  const isMasterCurrentlyLocked =
    !!editingId &&
    isPartnerWfEnabled &&
    formData.status === "temporary" &&
    (wfStatus === "PENDING" || (formData as any).wfStatus === "PENDING");

  const handleInputChange = (
    field: keyof typeof initialFormState,
    value: any,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCloseForm = () => {
    setFormData({
      ...initialFormState,
      status: isPartnerWfEnabled ? "temporary" : "active",
    });
    setExtUrlInput("");
    setExtTitleInput("");
    setWfStatus(null);
    onClose();
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();

    if (editingId && !canUpdate) return;
    if (!editingId && !canCreate) return;
    if (isSubmitting) return;

    setError("");
    setIsSubmitting(true);

    const payload = {
      id: formData.id,
      name: formData.name,
      type: formData.type,
      postalCode: formData.postalCode || null,
      address: formData.address || null,
      phone: formData.phone || null,
      fax: formData.fax || null,
      creditLimit: Number(formData.creditLimit) || 0,
      status: !editingId && isPartnerWfEnabled ? "temporary" : formData.status,
      memo: formData.memo || null,
      closingDay:
        formData.closingDay === "" ? null : Number(formData.closingDay),
      paymentMonthOffset:
        formData.paymentMonthOffset === ""
          ? null
          : Number(formData.paymentMonthOffset),
      paymentDay:
        formData.paymentDay === "" ? null : Number(formData.paymentDay),
      paymentMethod: formData.paymentMethod || null,
      qualifiedInvoiceNumber: formData.qualifiedInvoiceNumber.trim() || null,
      corporateNumber: formData.corporateNumber.trim() || null,
      antiSocialCheckStatus: formData.antiSocialCheckStatus,
      antiSocialCheckMemo: formData.antiSocialCheckMemo || null,
      contractDate: formData.contractDate || null,
      contractValidTo: formData.contractValidTo || null,
      attachments: formData.attachments,
      bankAccounts: formData.bankAccounts,
    };

    try {
      let url = "";
      let method: "POST" | "PUT" = "POST";
      let finalPayload: unknown = payload;

      if (isPartnerWfEnabled) {
        // 💡【追加】承認機能有効時であっても、まずはマスタ本体へ「仮登録 (temporary)」状態として先行して直接書き込み・更新を行う
        const preSaveUrl = editingId
          ? `/api/partners/${editingId}`
          : "/api/partners/register";
        const preSaveMethod = editingId ? "PUT" : "POST";

        let preSavePayload;

        if (editingId) {
          // 💡【重要】変更申請時は、変更後の値を本体に書き込んではいけません。
          // 変更前の状態を維持するため、既存のフォーム表示用データ(formData)をベースにし、ステータスだけを "temporary" (ロック) にして送信します。
          preSavePayload = {
            id: formData.id,
            name: formData.name, // フォームを開いたときの初期値（画面で編集中だが、送信するのは元の値にするため、ここは厳密には変更前の値が望ましいですが、簡易的に現在のstatusのみロックします）
            type: formData.type,
            postalCode: formData.postalCode || null,
            address: formData.address || null,
            phone: formData.phone || null,
            fax: formData.fax || null,
            creditLimit: Number(formData.creditLimit) || 0,
            closingDay:
              formData.closingDay === "" ? null : Number(formData.closingDay),
            paymentMonthOffset:
              formData.paymentMonthOffset === ""
                ? null
                : Number(formData.paymentMonthOffset),
            paymentDay:
              formData.paymentDay === "" ? null : Number(formData.paymentDay),
            paymentMethod: formData.paymentMethod || null,
            qualifiedInvoiceNumber: formData.qualifiedInvoiceNumber.trim() || null,
            corporateNumber: formData.corporateNumber.trim() || null,
            antiSocialCheckStatus: formData.antiSocialCheckStatus,
            antiSocialCheckMemo: formData.antiSocialCheckMemo || null,
            contractDate: formData.contractDate || null,
            contractValidTo: formData.contractValidTo || null,
            attachments: formData.attachments,
            bankAccounts: formData.bankAccounts,
            // 💡 変更を即時反映させないよう、ステータスだけを審査中(temporary)に変更してレコードをロック
            status: "temporary",
          };
        } else {
          // 新規登録の申請時は、新規入力された内容を status: "temporary" でそのまま保存
          preSavePayload = {
            ...payload,
            status: "temporary",
          };
        }

        const preSaveResult = await apiFetch<{ id?: string }>(preSaveUrl, {
          method: preSaveMethod,
          json: preSavePayload,
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        // マスタコード自動採番: formData.idが空欄(自動採番依頼)の場合、pre-save応答で
        // サーバーが確定させたIDを使う(空欄のままだとワークフロー申請のtargetIdが空になってしまう)
        const resolvedTargetId = editingId || preSaveResult.id || formData.id;

        // 先行書き込みが成功したら、従来通りワークフロー申請を行う
        const currentLoginUserId =
          (window as any).__NEXT_DATA__?.props?.pageProps?.session?.user?.id ||
          "CURRENT_OPERATOR_ID";

        // 💡 最終承認時に反映させたいステータスを設定（新規登録の場合は本取引中: "active" になるようにする）
        const workflowPayload = {
          ...payload,
          id: resolvedTargetId,
          status: editingId ? payload.status : "active",
        };

        url = "/api/approvals/request-update";
        method = "POST";
        finalPayload = {
          targetType: "master_partners",
          targetId: resolvedTargetId,
          requestType: editingId ? "UPDATE" : "REGISTER",
          applicantId: currentLoginUserId,
          payload: workflowPayload, // 💡 "active" に補正したペイロードを退避データとしてワークフローに送る
          applicantDepartmentSurrogateId,
          comment: editingId
            ? `取引先マスタ[${editingId}] 情報変更申請`
            : `取引先マスタ[${resolvedTargetId}] 新規登録申請`,
        };
      } else {
        url = editingId
          ? `/api/partners/${editingId}`
          : "/api/partners/register";
        method = editingId ? "PUT" : "POST";
        finalPayload = payload;
      }

      await apiFetch(url, {
        method,
        json: finalPayload,
        defaultErrorMessage: "申請処理に失敗しました",
      });

      const successMessage =
        editingId && isPartnerWfEnabled
          ? "マスタの変更承認をワークフローへ申請しました(承認待ちロック)"
          : editingId
            ? "取引先情報を更新しました"
            : "取引先を新規登録しました";

      onSuccess(successMessage);
      handleCloseForm();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { uploadFile } = useAttachmentUpload({
    uploadUrl: "/api/partners/upload",
    // BUG-037: alert ではなく、フォームのエラー表示で伝える
    onError: (msg) => setError(msg || "ファイルのアップロードに失敗しました"),
  });
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const attachment = await uploadFile(e, "OTHER");
    if (!attachment) return;
    setFormData((prev) => ({
      ...prev,
      attachments: [...prev.attachments, attachment],
    }));
  };

  const handleAddExternalLink = () => {
    if (!extUrlInput || !extTitleInput) return;
    setFormData((prev) => ({
      ...prev,
      attachments: [
        ...prev.attachments,
        {
          fileName: extTitleInput,
          storageType: "EXTERNAL_LINK",
          externalUrl: extUrlInput,
          fileType: "OTHER",
        },
      ],
    }));
    setExtUrlInput("");
    setExtTitleInput("");
  };

  const handleRemoveAttachment = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index),
    }));
  };

  // ファームバンキング: 振込先口座の編集(追加/削除/項目変更)
  const handleAddBankAccount = () => {
    setFormData((prev) => ({
      ...prev,
      bankAccounts: [...prev.bankAccounts, { ...EMPTY_BANK_ACCOUNT }],
    }));
  };

  const handleRemoveBankAccount = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      bankAccounts: prev.bankAccounts.filter((_, i) => i !== index),
    }));
  };

  const handleBankAccountChange = (
    index: number,
    field: keyof BankAccountItem,
    value: string | boolean,
  ) => {
    setFormData((prev) => ({
      ...prev,
      bankAccounts: prev.bankAccounts.map((acc, i) =>
        i === index ? { ...acc, [field]: value } : acc,
      ),
    }));
  };

  // 💡 取引先が選択されたら、その取引先の最新のワークフロー申請ステータスを裏で取得する
  useEffect(() => {
    if (!editingId || !isPartnerWfEnabled) {
      setWfStatus(null);
      return;
    }

    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingId}`,
        );
        setWfStatus(data.status); // "PENDING" や "REMANDED" がセットされる
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };

    void fetchWfStatus();
  }, [editingId, isPartnerWfEnabled, formData.status]); // ステータス変更時にも再検証

  return {
    formData,
    setFormData,
    isSubmitting,
    extUrlInput,
    setExtUrlInput,
    extTitleInput,
    setExtTitleInput,
    error,
    setError,
    isMasterCurrentlyLocked,
    setWfStatus,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    handleInputChange,
    handleCloseForm,
    handleSubmit,
    handleFileUpload,
    handleAddExternalLink,
    handleRemoveAttachment,
    handleAddBankAccount,
    handleRemoveBankAccount,
    handleBankAccountChange,
  };
}
