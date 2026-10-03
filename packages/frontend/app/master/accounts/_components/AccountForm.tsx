"use client";

import { useEffect, useState } from "react";
import { AccountRecord } from "../_types";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface AccountFormProps {
  editingAccount: AccountRecord | null;
  onCancelEdit: () => void;
  onSubmit: (data: {
    code: string;
    name: string;
    externalMappingCode: string;
    status: "temporary" | "active" | "suspended";
    memo: string;
  }) => Promise<void>;
  canCreate: boolean;
  canUpdate: boolean;
  isAccountWfEnabled?: boolean;
  isLocked?: boolean;
  isSubmitting?: boolean;
  departments?: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId?: string | null;
  setApplicantDepartmentSurrogateId?: (value: string) => void;
}

export function AccountForm({
  editingAccount,
  onCancelEdit,
  onSubmit,
  canCreate,
  canUpdate,
  isAccountWfEnabled = false,
  isLocked = false,
  isSubmitting = false,
  departments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
}: AccountFormProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [externalMappingCode, setExternalMappingCode] = useState("");
  const [status, setStatus] = useState<"temporary" | "active" | "suspended">(
    "temporary",
  );
  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (editingAccount) {
      setCode(editingAccount.code);
      setName(editingAccount.name);
      setExternalMappingCode(editingAccount.externalMappingCode || "");
      setStatus(editingAccount.status);
      setMemo(editingAccount.memo || "");
    } else {
      resetForm();
    }
  }, [editingAccount]);

  const resetForm = () => {
    setCode("");
    setName("");
    setExternalMappingCode("");
    setStatus("temporary");
    setMemo("");
  };

  const handleSubmitInternal = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    await onSubmit({ code, name, externalMappingCode, status, memo });
    if (!editingAccount) {
      resetForm();
    }
  };

  const hasFormPermission = editingAccount ? canUpdate : canCreate;
  const inputClass = formFieldInputClass;

  return (
    <form
      onSubmit={handleSubmitInternal}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      {isLocked && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-black rounded-lg flex items-center space-x-2">
          <span>🔒</span>
          <span>
            このデータは現在、承認ワークフローの審査中(仮登録)のため、承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます。
          </span>
        </div>
      )}

      <fieldset
        disabled={!hasFormPermission || isSubmitting || isLocked}
        className="space-y-4 w-full"
      >
        <div className="flex items-center justify-between border-b pb-1">
          <h3 className="text-xs font-bold text-slate-900">
            {editingAccount ? "勘定科目情報の編集" : "新規個別勘定科目登録"}
          </h3>
          {!hasFormPermission && (
            <span className="text-[9px] bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded font-bold">
              閲覧専用
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="科目コード" required>
            <input
              type="text"
              required
              disabled={!!editingAccount}
              className={inputClass}
              placeholder="例: 1111"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </FormField>
          <FormField label="科目表示名" required>
            <input
              type="text"
              required
              className={inputClass}
              placeholder="例: 商品原材料高"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="外部会計システム連携コード">
            <input
              type="text"
              className={inputClass}
              placeholder="例: OB_1111"
              value={externalMappingCode}
              onChange={(e) => setExternalMappingCode(e.target.value)}
            />
          </FormField>
          <FormField label="ステータス">
            <select
              disabled={!editingAccount || isAccountWfEnabled}
              className={`${inputClass} ${
                !editingAccount || isAccountWfEnabled
                  ? "cursor-not-allowed"
                  : "cursor-pointer"
              }`}
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              <option value="temporary">仮登録</option>
              <option value="active">有効</option>
              <option value="suspended">無効</option>
            </select>
            {isAccountWfEnabled && (
              <p className="text-[10px] text-slate-600 mt-1">
                承認機能が有効なため、ステータスは一覧の「無効化」操作から申請してください。
              </p>
            )}
          </FormField>
        </div>

        {isAccountWfEnabled && (
          <ApplicantDepartmentSelect
            departments={departments}
            value={applicantDepartmentSurrogateId}
            onChange={setApplicantDepartmentSurrogateId}
          />
        )}

        <FormField label="内訳・摘要・メモ">
          <textarea
            className={`${inputClass} h-16 resize-none`}
            placeholder="特記事項があれば入力"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </FormField>
      </fieldset>

      <div className="flex gap-2 pt-2">
        {editingAccount && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="w-1/3 border border-slate-300 bg-white text-slate-600 py-2 rounded text-xs font-bold cursor-pointer hover:bg-slate-50 text-center shadow-sm"
          >
            キャンセル
          </button>
        )}
        <button
          type="submit"
          disabled={!hasFormPermission || isSubmitting || isLocked}
          className={`py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
            hasFormPermission && !isSubmitting && !isLocked
              ? isAccountWfEnabled
                ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 cursor-pointer"
                : "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          } ${editingAccount ? "w-2/3" : "w-full"}`}
        >
          {isSubmitting
            ? isAccountWfEnabled
              ? "⏳ 承認申請を送信中..."
              : "処理中..."
            : editingAccount
              ? isAccountWfEnabled
                ? "🔀 変更を申請する"
                : "保存"
              : isAccountWfEnabled
                ? "✨ 承認を申請する"
                : "登録"}
        </button>
      </div>
    </form>
  );
}
