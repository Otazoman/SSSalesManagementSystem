"use client";

import { DepartmentRecord, DepartmentFormState } from "../_types";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";

interface DepartmentFormProps {
  editingSurrogateId: string | null;
  canCreate: boolean;
  canUpdate: boolean;
  isSubmitting?: boolean;
  departments: DepartmentRecord[];
  formState: DepartmentFormState;
  setFormState: React.Dispatch<React.SetStateAction<DepartmentFormState>>;
  onSubmit: (e: React.SyntheticEvent) => void;
}

export default function DepartmentForm({
  editingSurrogateId,
  canCreate,
  canUpdate,
  isSubmitting = false,
  departments,
  formState,
  setFormState,
  onSubmit,
}: DepartmentFormProps) {
  const isEditMode = !!editingSurrogateId;
  const hasAccess = (isEditMode && canUpdate) || (!isEditMode && canCreate);

  const handleInputChange = (key: keyof DepartmentFormState, value: string) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const inputClass = formFieldInputClass;

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      {!hasAccess && (
        <div className="absolute top-2 right-4 text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded">
          閲覧専用
        </div>
      )}

      <fieldset
        disabled={!hasAccess || isSubmitting}
        className="space-y-4 w-full"
      >
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
          {isEditMode ? "部署データの編集" : "新規部署・組織階層定義"}
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="部署コードID" required>
            <input
              type="text"
              required
              disabled={isEditMode}
              className={inputClass}
              placeholder="例: 0006"
              value={formState.deptId}
              onChange={(e) => handleInputChange("deptId", e.target.value)}
            />
          </FormField>
          <FormField label="部署・組織名" required>
            <input
              type="text"
              required
              className={inputClass}
              placeholder="例: 開発第一チーム"
              value={formState.deptName}
              onChange={(e) => handleInputChange("deptName", e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="親組織">
          <select
            className={`${inputClass} cursor-pointer bg-white`}
            value={formState.deptParent}
            onChange={(e) => handleInputChange("deptParent", e.target.value)}
          >
            <option value="">親組織なし (最上位ルート組織)</option>
            {departments
              .filter((d) => d.id !== formState.deptId)
              .map((d, index) => (
                <option key={`${d.id}-${index}`} value={d.id}>
                  {d.name} (ID: {d.id})
                </option>
              ))}
          </select>
        </FormField>

        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
          <h4 className="text-[10px] font-bold text-slate-700">
            📅 マスタ適用期間
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="適用開始日" required>
              <input
                type="date"
                required
                className={`${inputClass} bg-white`}
                value={formState.deptValidFrom}
                onChange={(e) =>
                  handleInputChange("deptValidFrom", e.target.value)
                }
              />
            </FormField>
            <FormField label="適用終了日 (任意)">
              <input
                type="date"
                className={`${inputClass} bg-white`}
                value={formState.deptValidTo}
                onChange={(e) =>
                  handleInputChange("deptValidTo", e.target.value)
                }
              />
            </FormField>
          </div>
        </div>

        <FormField label="備考説明">
          <textarea
            className={`${inputClass} h-16 resize-none`}
            placeholder="部署の説明や特記事項を入力"
            value={formState.deptMemo}
            onChange={(e) => handleInputChange("deptMemo", e.target.value)}
          />
        </FormField>
      </fieldset>

      <div className="pt-2">
        <button
          type="submit"
          disabled={!hasAccess || isSubmitting}
          className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
            hasAccess && !isSubmitting
              ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          {isSubmitting ? "処理中..." : isEditMode ? "保存" : "登録"}
        </button>
      </div>
    </form>
  );
}
