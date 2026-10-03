"use client";

import React from "react";
import { formFieldInputClass, formFieldLabelClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface BusinessLocationFormProps {
  form: ReturnType<
    typeof import("../_hooks/useBusinessLocationForm").useBusinessLocationForm
  >;
  canCreate: boolean;
  canUpdate: boolean;
  isBusinessLocationWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onSubmitSuccess: () => void;
}

const inputClass = formFieldInputClass;
const labelClass = `${formFieldLabelClass} mb-0.5`;

export function BusinessLocationForm({
  form,
  canCreate,
  canUpdate,
  isBusinessLocationWfEnabled = false,
  departments = [],
  onSubmitSuccess,
}: BusinessLocationFormProps) {
  const canSubmitFormBase = form.editingId ? canUpdate : canCreate;
  const isLocked = form.isBusinessLocationCurrentlyLocked;
  const canSubmitForm = canSubmitFormBase && !isLocked;

  const handleFormSubmit = async (e: React.SyntheticEvent) => {
    const success = await form.handleSubmit(e);
    if (success) {
      onSubmitSuccess();
    }
  };

  return (
    <form
      onSubmit={handleFormSubmit}
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

      <div className="flex items-center justify-between border-b pb-1">
        <h3 className="text-xs font-bold text-slate-900">
          {form.editingId ? "📝 営業拠点情報の修正変更" : "📌 新規個別営業拠点登録"}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>拠点コード</label>
          <input
            type="text"
            disabled={!canCreate || !!form.editingId}
            className={inputClass}
            placeholder="空欄で自動採番"
            value={form.formData.id}
            onChange={(e) => form.handleInputChange("id", e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>拠点名 *</label>
          <input
            type="text"
            required
            disabled={!canSubmitForm}
            className={inputClass}
            value={form.formData.name}
            onChange={(e) => form.handleInputChange("name", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>郵便番号</label>
          <input
            type="text"
            disabled={!canSubmitForm}
            className={inputClass}
            value={form.formData.postalCode}
            onChange={(e) => form.handleInputChange("postalCode", e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>電話番号</label>
          <input
            type="text"
            disabled={!canSubmitForm}
            className={inputClass}
            value={form.formData.phoneNumber}
            onChange={(e) => form.handleInputChange("phoneNumber", e.target.value)}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-0.5">
          <label className={formFieldLabelClass}>住所</label>
          {form.formData.address.trim() && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.formData.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 hover:text-blue-800 font-bold transition-colors"
            >
              <span>🗺️</span>
              <span>地図で見る</span>
            </a>
          )}
        </div>
        <input
          type="text"
          disabled={!canSubmitForm}
          className={inputClass}
          value={form.formData.address}
          onChange={(e) => form.handleInputChange("address", e.target.value)}
          placeholder="例: 東京都千代田区..."
        />
      </div>

      <div>
        <label className={labelClass}>状態 *</label>
        <select
          disabled={!canSubmitForm || isBusinessLocationWfEnabled}
          className={inputClass}
          value={form.formData.status}
          onChange={(e) => form.handleInputChange("status", e.target.value)}
        >
          <option value="temporary">仮登録</option>
          <option value="active">有効</option>
          <option value="suspended">無効</option>
        </select>
        {isBusinessLocationWfEnabled && (
          <p className="text-[10px] text-slate-600 mt-1">
            承認機能が有効なため、状態は一覧の「無効化」操作から申請してください。
          </p>
        )}
      </div>

      {isBusinessLocationWfEnabled && (
        <ApplicantDepartmentSelect
          departments={departments}
          value={form.applicantDepartmentSurrogateId}
          onChange={form.setApplicantDepartmentSurrogateId}
        />
      )}

      <div>
        <label className={labelClass}>備考・メモ</label>
        <textarea
          disabled={!canSubmitForm}
          className={`${inputClass} h-14 resize-none`}
          placeholder="特記事項を入力"
          value={form.formData.memo}
          onChange={(e) => form.handleInputChange("memo", e.target.value)}
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmitForm || form.isSubmitting}
        className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
          canSubmitForm && !form.isSubmitting
            ? isBusinessLocationWfEnabled
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 cursor-pointer"
              : "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            : "bg-slate-300 text-slate-500 cursor-not-allowed"
        }`}
      >
        {form.isSubmitting
          ? isBusinessLocationWfEnabled
            ? "⏳ 承認申請を送信中..."
            : "処理中..."
          : form.editingId
            ? isBusinessLocationWfEnabled
              ? "🔀 変更を申請する"
              : "変更をマスタへ保存"
            : isBusinessLocationWfEnabled
              ? "✨ 承認を申請する"
              : "登録"}
      </button>
    </form>
  );
}
