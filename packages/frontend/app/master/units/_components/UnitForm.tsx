"use client";

import { UnitRecord } from "../_types";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface UnitFormProps {
  code: string;
  name: string;
  status: string;
  editingUnit: UnitRecord | null;
  canCreate: boolean;
  canUpdate: boolean;
  isSubmitting?: boolean;
  isUnitWfEnabled?: boolean;
  isUnitCurrentlyLocked?: boolean;
  departments?: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId?: string | null;
  setApplicantDepartmentSurrogateId?: (value: string) => void;
  setCode: (value: string) => void;
  setName: (value: string) => void;
  setStatus: (value: string) => void;
  onSubmit: (e: React.SyntheticEvent) => void;
  onCancel: () => void;
}

export function UnitForm({
  code,
  name,
  status,
  editingUnit,
  canCreate,
  canUpdate,
  isSubmitting = false,
  isUnitWfEnabled = false,
  isUnitCurrentlyLocked = false,
  departments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
  setCode,
  setName,
  setStatus,
  onSubmit,
  onCancel,
}: UnitFormProps) {
  const canSubmitForm = editingUnit ? canUpdate : canCreate;

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      {isUnitCurrentlyLocked && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-black rounded-lg flex items-center space-x-2">
          <span>🔒</span>
          <span>
            このデータは現在、承認ワークフローの審査中(仮登録)のため、承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます。
          </span>
        </div>
      )}

      <fieldset
        disabled={!canSubmitForm || isSubmitting || isUnitCurrentlyLocked}
        className="space-y-4 w-full"
      >
        <div className="flex justify-between items-center border-b pb-1">
          <h3 className="text-xs font-bold text-slate-900">
            {editingUnit ? "単位情報の編集" : "新規個別単位登録"}
          </h3>
          {!canSubmitForm && (
            <span className="text-[9px] bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded font-bold">
              閲覧専用
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="単位コード" required>
            <input
              type="text"
              required
              disabled={!!editingUnit}
              className={formFieldInputClass}
              placeholder="例: PCS, KG, M"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </FormField>

          <FormField label="単位名称" required>
            <input
              type="text"
              required
              className={formFieldInputClass}
              placeholder="例: 個, キログラム"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
        </div>

        <div>
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            ステータス
          </label>
          <select
            disabled={isUnitWfEnabled}
            className={`${formFieldInputClass} ${isUnitWfEnabled ? "bg-slate-100 text-slate-500 cursor-not-allowed" : "cursor-pointer"}`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">有効</option>
            <option value="temporary">仮登録</option>
            <option value="suspended">無効</option>
          </select>
          {isUnitWfEnabled && (
            <p className="text-[9px] text-indigo-600 font-bold mt-1">
              🛡️
              承認機能有効化のため、ステータス変更はワークフロー審査で行います。
            </p>
          )}
        </div>

        {isUnitWfEnabled && (
          <ApplicantDepartmentSelect
            departments={departments}
            value={applicantDepartmentSurrogateId}
            onChange={setApplicantDepartmentSurrogateId}
          />
        )}
      </fieldset>

      <div className="flex gap-2 pt-2">
        {editingUnit && (
          <button
            type="button"
            onClick={onCancel}
            className="w-1/3 border border-slate-300 bg-white text-slate-600 py-2 rounded text-xs font-bold cursor-pointer hover:bg-slate-50 text-center shadow-sm"
          >
            キャンセル
          </button>
        )}
        {editingUnit ? (
          isUnitWfEnabled ? (
            <button
              type="submit"
              disabled={isSubmitting || isUnitCurrentlyLocked}
              className={`py-2 rounded text-xs font-bold text-white transition-colors shadow-sm w-2/3 ${
                !isSubmitting && !isUnitCurrentlyLocked
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 cursor-pointer"
                  : "bg-slate-300 text-slate-500 cursor-not-allowed"
              }`}
            >
              {isSubmitting
                ? "⏳ 変更申請を送信中..."
                : "🔀 変更を申請する"}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSubmitForm || isSubmitting}
              className={`py-2 rounded text-xs font-bold text-white transition-colors shadow-sm w-2/3 ${
                canSubmitForm && !isSubmitting
                  ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
                  : "bg-slate-300 text-slate-500 cursor-not-allowed"
              }`}
            >
              {isSubmitting ? "処理中..." : "保存"}
            </button>
          )
        ) : isUnitWfEnabled ? (
          <button
            type="submit"
            disabled={!canSubmitForm || isSubmitting}
            className={`py-2.5 rounded-lg text-xs font-black text-white tracking-wide transition-all duration-200 shadow-md w-full ${
              canSubmitForm && !isSubmitting
                ? "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 cursor-pointer hover:shadow-lg active:scale-[0.99]"
                : "bg-slate-300 text-slate-500 cursor-not-allowed shadow-none"
            }`}
          >
            {isSubmitting
              ? "⏳ 承認リクエスト送信中..."
              : "✨ 承認を申請する"}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSubmitForm || isSubmitting}
            className={`py-2 rounded text-xs font-bold text-white transition-colors shadow-sm w-full ${
              canSubmitForm && !isSubmitting
                ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
                : "bg-slate-300 text-slate-500 cursor-not-allowed"
            }`}
          >
            {isSubmitting ? "登録処理中..." : "登録"}
          </button>
        )}
      </div>
    </form>
  );
}
