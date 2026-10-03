import { useState, useEffect } from "react";
import { ContactRecord, PartnerLookup, UserLookup } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import { DocumentTypeChecklist } from "../../../_shared/ui/DocumentTypeChecklist";
import { PARTNER_CONTACT_DOCUMENT_TYPE_OPTIONS } from "../../../_shared/contact-document-types";
import type { ApplicantDepartmentOption } from "../../../types";

const ALL_DOCUMENT_TYPES = PARTNER_CONTACT_DOCUMENT_TYPE_OPTIONS.map((o) => o.value);

interface ContactFormProps {
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  initialValues: (Omit<ContactRecord, "id"> & { id: string }) | null;
  partners: PartnerLookup[];
  users: UserLookup[];
  hasFormPermission: boolean;
  canCreate: boolean;
  isPartnerContactWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onSuccess: (message: string) => void;
  onError: (error: string) => void;
  onSync: () => void;
  onImportCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCloseForm: () => void;
}

export function ContactForm({
  editingId,
  setEditingId,
  initialValues,
  partners,
  users,
  hasFormPermission,
  canCreate,
  isPartnerContactWfEnabled = false,
  departments = [],
  onSuccess,
  onError,
  onSync,
  onImportCsv,
  onCloseForm,
}: ContactFormProps) {
  const isCsvImportDisabled = !canCreate || isPartnerContactWfEnabled;
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
  const [ctId, setCtId] = useState("");
  const [ctPartnerId, setCtPartnerId] = useState("");
  const [ctType, setCtType] =
    useState<ContactRecord["contactType"]>("CUSTOMER_CONTACT");
  const [ctInternalUserId, setCtInternalUserId] = useState("");
  const [ctName, setCtName] = useState("");
  const [ctEmail, setCtEmail] = useState("");
  const [ctPhone, setCtPhone] = useState("");
  const [ctFax, setCtFax] = useState("");
  const [ctDeptName, setCtDeptName] = useState("");
  const [ctIsEmailTarget, setCtIsEmailTarget] = useState(true);
  // V-5: メールで送る帳票(新規登録の既定はすべて)
  const [ctDocumentTypes, setCtDocumentTypes] = useState<string[]>(ALL_DOCUMENT_TYPES);
  const [ctMemo, setCtMemo] = useState("");
  const [ctStatus, setCtStatus] = useState(
    isPartnerContactWfEnabled ? "temporary" : "active",
  );
  const [wfStatus, setWfStatus] = useState<string | null>(null);

  // 💡 取引先マスタと同じロック機構: 編集中の担当者が承認ワークフロー審査中(PENDING)なら、
  // フォームを完全ロックする(上書き・再編集防止)
  const isContactCurrentlyLocked =
    !!editingId &&
    isPartnerContactWfEnabled &&
    ctStatus === "temporary" &&
    wfStatus === "PENDING";

  useEffect(() => {
    if (!editingId || !isPartnerContactWfEnabled) {
      setWfStatus(null);
      return;
    }

    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingId}?targetType=master_contacts`,
        );
        setWfStatus(data.status);
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };

    void fetchWfStatus();
  }, [editingId, isPartnerContactWfEnabled, ctStatus]);

  // 編集モード移行時の値セット
  useEffect(() => {
    if (initialValues) {
      setCtId(initialValues.id);
      setCtPartnerId(initialValues.partnerId || "");
      setCtType(initialValues.contactType);
      setCtInternalUserId(initialValues.internalUserId || "");
      setCtName(initialValues.name || "");
      setCtEmail(initialValues.email || "");
      setCtPhone(initialValues.phone || "");
      setCtFax(initialValues.fax || "");
      setCtDeptName(initialValues.departmentName || "");
      setCtIsEmailTarget(initialValues.isEmailTarget);
      setCtDocumentTypes(
        initialValues.documentTypes ??
          (initialValues.isEmailTarget ? ALL_DOCUMENT_TYPES : []),
      );
      setCtMemo(initialValues.memo || "");
      setCtStatus(initialValues.status || "active");
    } else {
      // 新規登録時の初期化
      setCtId("");
      setCtPartnerId("");
      setCtType("CUSTOMER_CONTACT");
      setCtInternalUserId("");
      setCtName("");
      setCtEmail("");
      setCtPhone("");
      setCtFax("");
      setCtDeptName("");
      setCtIsEmailTarget(true);
      setCtDocumentTypes(ALL_DOCUMENT_TYPES);
      setCtMemo("");
      setCtStatus(isPartnerContactWfEnabled ? "temporary" : "active");
    }
  }, [initialValues, editingId, isPartnerContactWfEnabled]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    onError("");
    onSuccess("");

    if (!editingId && !canCreate) {
      onError("登録する権限がありません");
      return;
    }

    const payload = {
      id: ctId,
      partnerId: ctPartnerId,
      contactType: ctType,
      internalUserId: ctType.startsWith("COMPANY_")
        ? ctInternalUserId || null
        : null,
      name: ctType.startsWith("COMPANY_") ? null : ctName || null,
      email: ctEmail || null,
      phone: ctPhone || null,
      fax: ctFax || null,
      departmentName: ctDeptName || null,
      isEmailTarget: ctIsEmailTarget,
      documentTypes: ctDocumentTypes,
      memo: ctMemo || null,
    };

    try {
      if (isPartnerContactWfEnabled) {
        // 💡 承認機能有効時であっても、まずはマスタ本体へ「仮登録(temporary)」状態として
        // 先行して直接書き込み・更新を行う(取引先マスタと同じ二段階方式)
        const preSaveUrl = editingId
          ? `/api/partner-contacts/${editingId}`
          : "/api/partner-contacts/register";
        const preSaveMethod = editingId ? "PUT" : "POST";

        const preSavePayload = editingId
          ? {
              // 変更申請時は、変更後の値を本体に書き込んではいけない。
              // 変更前の状態を維持するため、ステータスだけを"temporary"(ロック)にして送信する。
              partnerId: initialValues?.partnerId ?? ctPartnerId,
              contactType: initialValues?.contactType ?? ctType,
              internalUserId: initialValues?.internalUserId ?? null,
              name: initialValues?.name ?? null,
              email: initialValues?.email ?? null,
              phone: initialValues?.phone ?? null,
              fax: initialValues?.fax ?? null,
              departmentName: initialValues?.departmentName ?? null,
              isEmailTarget: initialValues?.isEmailTarget ?? true,
              documentTypes: initialValues?.documentTypes,
              memo: initialValues?.memo ?? null,
              status: "temporary",
            }
          : { ...payload, status: "temporary" };

        const preSaveResult = await apiFetch<{ id?: string }>(preSaveUrl, {
          method: preSaveMethod,
          json: preSavePayload,
          defaultErrorMessage:
            "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        // マスタコード自動採番: ctIdが空欄(自動採番依頼)の場合、pre-save応答でサーバーが
        // 確定させたIDを使う(空欄のままだとワークフロー申請のtargetIdが空になってしまう)
        const resolvedTargetId = editingId || preSaveResult.id || ctId;

        const workflowPayload = {
          ...payload,
          id: resolvedTargetId,
          status: editingId ? ctStatus : "active",
        };

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_contacts",
            targetId: resolvedTargetId,
            requestType: editingId ? "UPDATE" : "REGISTER",
            payload: workflowPayload,
            applicantDepartmentSurrogateId,
            comment: editingId
              ? `取引先担当者マスタ[${resolvedTargetId}] 情報変更申請`
              : `取引先担当者マスタ[${resolvedTargetId}] 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });

        onSuccess(
          editingId
            ? "マスタの変更承認をワークフローへ申請しました(承認待ちロック)"
            : "担当者を仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        const url = editingId
          ? `/api/partner-contacts/${editingId}`
          : "/api/partner-contacts/register";
        await apiFetch(url, {
          method: editingId ? "PUT" : "POST",
          json: editingId ? { ...payload, status: ctStatus } : payload,
          defaultErrorMessage: "登録に失敗しました",
        });

        onSuccess(
          editingId ? "担当者情報を更新しました" : "新しく担当者を登録しました",
        );
      }

      setEditingId(null);
      onCloseForm();
      onSync();
    } catch (err) {
      if (err instanceof Error) onError(err.message);
    }
  };

  const inputClass = formFieldInputClass;
  const disabledInputClass = "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm"
      >
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
          {editingId ? "担当者情報の編集" : "新規個別担当者登録"}
        </h3>

        {!hasFormPermission && (
          <p className="text-[10px] text-red-500 font-bold bg-red-50 p-1.5 rounded border border-red-100">
            ⚠️ データを登録・編集する権限がありません。
          </p>
        )}

        {isContactCurrentlyLocked && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-black rounded-lg flex items-center space-x-2">
            <span>🔒</span>
            <span>
              このデータは現在、承認ワークフローの審査中(仮登録)のため、承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます。
            </span>
          </div>
        )}

        <fieldset
          disabled={!hasFormPermission || isContactCurrentlyLocked}
          className="space-y-4 w-full"
        >
          <div className="grid grid-cols-2 gap-3">
            <FormField label="担当者管理コード">
              <input
                type="text"
                disabled={!!editingId}
                className={`${inputClass} ${disabledInputClass}`}
                placeholder="例: CON-001(空欄で自動採番)"
                value={ctId}
                onChange={(e) => setCtId(e.target.value)}
              />
            </FormField>
            <FormField label="対象取引先" required>
              <select
                required
                className={`${inputClass} ${disabledInputClass} cursor-pointer`}
                value={ctPartnerId}
                onChange={(e) => setCtPartnerId(e.target.value)}
              >
                <option value="">-- 選択してください --</option>
                {partners.map((c) => {
                  const isSuspended = c.status === "suspended";
                  if (!editingId && isSuspended) return null;
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name}{" "}
                      {isSuspended
                        ? "(🛑無効)"
                        : c.status === "temporary"
                          ? "(仮登録/申請中)"
                          : ""}
                    </option>
                  );
                })}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="担当区分" required>
              <select
                className={`${inputClass} ${disabledInputClass} cursor-pointer`}
                value={ctType}
                onChange={(e) => setCtType(e.target.value as any)}
              >
                <option value="CUSTOMER_CONTACT">相手方得意先担当者</option>
                <option value="SUPPLIER_CONTACT">相手方仕入先担当者</option>
                <option value="COMPANY_SALES">自社営業側担当者</option>
                <option value="COMPANY_BUYER">自社購買側担当者</option>
              </select>
            </FormField>
            {ctType.startsWith("COMPANY_") ? (
              <FormField label="自社ユーザー選択" required>
                <select
                  required
                  className={`${inputClass} ${disabledInputClass} cursor-pointer`}
                  value={ctInternalUserId}
                  onChange={(e) => setCtInternalUserId(e.target.value)}
                >
                  <option value="">-- ユーザーを選択 --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </FormField>
            ) : (
              <FormField label="相手方氏名" required>
                <input
                  type="text"
                  required
                  className={`${inputClass} ${disabledInputClass}`}
                  placeholder="山田 太郎"
                  value={ctName}
                  onChange={(e) => setCtName(e.target.value)}
                />
              </FormField>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="メールアドレス">
              <input
                type="email"
                className={`${inputClass} ${disabledInputClass}`}
                placeholder="example@email.com"
                value={ctEmail}
                onChange={(e) => setCtEmail(e.target.value)}
              />
            </FormField>
            <FormField label="部署・役職名">
              <input
                type="text"
                className={`${inputClass} ${disabledInputClass}`}
                placeholder="購買部 第一課"
                value={ctDeptName}
                onChange={(e) => setCtDeptName(e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="電話番号">
              <input
                type="tel"
                className={`${inputClass} ${disabledInputClass}`}
                placeholder="03-1234-5678"
                value={ctPhone}
                onChange={(e) => setCtPhone(e.target.value)}
              />
            </FormField>
            <FormField label="FAX番号">
              <input
                type="tel"
                className={`${inputClass} ${disabledInputClass}`}
                placeholder="03-1234-5679"
                value={ctFax}
                onChange={(e) => setCtFax(e.target.value)}
              />
            </FormField>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="emailTarget"
              checked={ctIsEmailTarget}
              onChange={(e) => setCtIsEmailTarget(e.target.checked)}
              className="w-4 h-4 disabled:cursor-not-allowed"
            />
            <label
              htmlFor="emailTarget"
              className="text-xs font-bold text-slate-700 cursor-pointer"
            >
              システム通知の対象に含める
            </label>
          </div>

          <DocumentTypeChecklist
            legend="メールで送る帳票"
            idPrefix="contact-document-type"
            options={PARTNER_CONTACT_DOCUMENT_TYPE_OPTIONS}
            value={ctDocumentTypes}
            onChange={setCtDocumentTypes}
          />

          <FormField label="備考・メモ">
            <textarea
              className={`${inputClass} ${disabledInputClass} h-16 resize-none`}
              placeholder="特記事項"
              value={ctMemo}
              onChange={(e) => setCtMemo(e.target.value)}
            />
          </FormField>

          <div>
            <label className="block text-[9px] font-bold text-slate-700 mb-0.5">
              ステータス
            </label>
            <select
              disabled={isPartnerContactWfEnabled}
              className={`${inputClass} ${isPartnerContactWfEnabled ? "bg-slate-100 text-slate-500 cursor-not-allowed" : "cursor-pointer"}`}
              value={ctStatus}
              onChange={(e) => setCtStatus(e.target.value)}
            >
              <option value="active">有効</option>
              <option value="temporary">仮登録</option>
              <option value="suspended">無効</option>
            </select>
            {isPartnerContactWfEnabled && (
              <p className="text-[9px] text-indigo-600 font-bold mt-1">
                🛡️
                承認機能有効化のため、ステータス変更はワークフロー審査で行います。
              </p>
            )}
          </div>

          {isPartnerContactWfEnabled && (
            <ApplicantDepartmentSelect
              departments={departments}
              value={applicantDepartmentSurrogateId}
              onChange={setApplicantDepartmentSurrogateId}
            />
          )}
        </fieldset>

        {editingId ? (
          isPartnerContactWfEnabled ? (
            <button
              type="submit"
              disabled={isContactCurrentlyLocked}
              className={`w-full py-2 rounded text-xs font-bold shadow-sm transition-colors ${
                !isContactCurrentlyLocked
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white cursor-pointer"
                  : "bg-slate-200 text-slate-500 opacity-70 cursor-not-allowed shadow-none"
              }`}
            >
              🔀 変更を申請する
            </button>
          ) : (
            <button
              type="submit"
              disabled={!hasFormPermission}
              className={`w-full py-2 rounded text-xs font-bold shadow-sm transition-colors ${
                hasFormPermission
                  ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                  : "bg-slate-200 text-slate-500 opacity-70 cursor-not-allowed shadow-none"
              }`}
            >
              保存
            </button>
          )
        ) : isPartnerContactWfEnabled ? (
          <button
            type="submit"
            disabled={!hasFormPermission}
            className={`w-full py-2.5 rounded-lg text-xs font-black shadow-md transition-all duration-200 ${
              hasFormPermission
                ? "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white cursor-pointer hover:shadow-lg active:scale-[0.99]"
                : "bg-slate-200 text-slate-500 opacity-70 cursor-not-allowed shadow-none"
            }`}
          >
            ✨ 承認を申請する
          </button>
        ) : (
          <button
            type="submit"
            disabled={!hasFormPermission}
            className={`w-full py-2 rounded text-xs font-bold shadow-sm transition-colors ${
              hasFormPermission
                ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                : "bg-slate-200 text-slate-500 opacity-70 cursor-not-allowed shadow-none"
            }`}
          >
            担当者情報を登録
          </button>
        )}
      </form>

      {/* CSV一括インポートパネル */}
      {!editingId && (
        <div className="bg-white p-5 rounded-lg flex flex-col justify-between border border-slate-200 shadow-sm">
          <div>
            <div className="flex justify-between items-center border-b pb-1 mb-2">
              <h3 className="text-xs font-bold text-slate-900">
                担当者CSV一括インポート
              </h3>
              {isPartnerContactWfEnabled && (
                <span className="text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
                  ※承認機能が有効な間は利用できません
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-600 leading-relaxed">
              右記ヘッダーに準拠したCSVファイルを選択してください：
              <code className="bg-slate-100 border border-slate-200 text-slate-700 p-1 rounded block mt-1 font-mono text-[9px] overflow-x-auto whitespace-nowrap">
                id,partnerId,contactType,internalUserId,name,email,phone,fax,departmentName,isEmailTarget,memo,documentTypes
              </code>
              <span className="block mt-1">
                documentTypes(メールで送る帳票)は「:」区切りで指定します(例: quote:billing)。空欄はどの帳票も送りません。列を付けない場合、新規の担当者は「システム通知の対象」に従います。
              </span>
            </p>
          </div>
          <label
            className={`border-2 border-dashed rounded p-6 block text-center mt-4 transition-colors ${
              !isCsvImportDisabled
                ? "border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-slate-700"
                : "border-slate-200 bg-slate-100 text-slate-500 opacity-70 cursor-not-allowed"
            }`}
          >
            <span className="text-xs font-bold">
              {!isCsvImportDisabled
                ? "担当者CSVファイルを選択"
                : "❌ 取り込み不可"}
            </span>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              disabled={isCsvImportDisabled}
              onChange={onImportCsv}
            />
          </label>
        </div>
      )}
    </div>
  );
}
