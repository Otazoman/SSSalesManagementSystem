import { ItemLookup } from "../_types";
import { formatToInputDate } from "../_hooks/useBomOperations";
import { formFieldInputClass, FormField } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface BomFormProps {
  editingId: string | null;
  parentItemId: string;
  setParentItemId: (val: string) => void;
  childItemId: string;
  setChildItemId: (val: string) => void;
  quantityRequired: number;
  setQuantityRequired: (val: number) => void;
  revision: string;
  setRevision: (val: string) => void;
  validFrom: string;
  setValidFrom: (val: string) => void;
  validTo: string;
  setValidTo: (val: string) => void;
  memo: string;
  setMemo: (val: string) => void;
  status: string;
  setStatus: (val: string) => void;
  allItems: ItemLookup[];
  canCreate: boolean;
  canUpdate: boolean;
  isSubmitting?: boolean;
  isItemStructureWfEnabled?: boolean;
  isStructureCurrentlyLocked?: boolean;
  departments?: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId?: string | null;
  setApplicantDepartmentSurrogateId?: (value: string) => void;
  onSubmit: (e: React.SyntheticEvent) => void;
  onCancel: () => void;
}

export function BomForm({
  editingId,
  parentItemId,
  setParentItemId,
  childItemId,
  setChildItemId,
  quantityRequired,
  setQuantityRequired,
  revision,
  setRevision,
  validFrom,
  setValidFrom,
  validTo,
  setValidTo,
  memo,
  setMemo,
  status,
  setStatus,
  allItems,
  canCreate,
  canUpdate,
  isSubmitting = false,
  isItemStructureWfEnabled = false,
  isStructureCurrentlyLocked = false,
  departments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
  onSubmit,
  onCancel,
}: BomFormProps) {
  const isEditable = editingId ? canUpdate : canCreate;

  const inputClass = formFieldInputClass;

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      {!isEditable && (
        <div className="absolute top-2 right-4 text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded">
          閲覧専用
        </div>
      )}

      {isStructureCurrentlyLocked && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-black rounded-lg flex items-center space-x-2">
          <span>🔒</span>
          <span>
            このデータは現在、承認ワークフローの審査中(仮登録)のため、承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます。
          </span>
        </div>
      )}

      <fieldset
        disabled={!isEditable || isSubmitting || isStructureCurrentlyLocked}
        className="space-y-4 w-full"
      >
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
          {editingId ? "品目構成リビジョンの編集" : "新規品目構成(BOM)の登録"}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
              親品目コード (上位アセンブリ) *
            </label>
            <select
              required
              disabled={!!editingId}
              className={`${inputClass} cursor-pointer`}
              value={parentItemId}
              onChange={(e) => setParentItemId(e.target.value)}
            >
              <option value="">-- 親品番を選択 --</option>
              {allItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.id}: {it.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
              構成部品コード (子品目パーツ) *
            </label>
            <select
              required
              disabled={!!editingId}
              className={`${inputClass} cursor-pointer`}
              value={childItemId}
              onChange={(e) => setChildItemId(e.target.value)}
            >
              <option value="">-- 子部品を選択 --</option>
              {allItems
                .filter((it) => it.status !== "suspended")
                .map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.id}: {it.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
          <h4 className="text-[10px] font-bold text-slate-700">
            ⚙️ 員数・リビジョン・適用期間
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
                必要数量 (員数) *
              </label>
              <input
                type="number"
                required
                min={0.0001}
                step="any"
                className={`${inputClass} font-bold bg-white`}
                value={quantityRequired}
                onChange={(e) => setQuantityRequired(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
                リビジョン (REV) *
              </label>
              <input
                type="text"
                required
                disabled={!!editingId}
                className={`${inputClass} font-mono font-bold text-center bg-white`}
                placeholder="例: 1.0"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
                適用開始日 *
              </label>
              <input
                type="date"
                required
                className={`${inputClass} bg-white`}
                value={formatToInputDate(validFrom)}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
              適用終了日 (空欄は無期限)
            </label>
            <input
              type="date"
              className={inputClass}
              value={formatToInputDate(validTo)}
              onChange={(e) => setValidTo(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
              設計変更メモ / 理由
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="例: ECN-2026-001"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        </div>

        <FormField label="ステータス">
          <select
            disabled={isItemStructureWfEnabled}
            className={`${inputClass} cursor-pointer`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">有効</option>
            <option value="temporary">仮登録</option>
            <option value="suspended">無効</option>
          </select>
          {isItemStructureWfEnabled && (
            <p className="text-[10px] text-slate-600 mt-1">
              承認機能が有効なため、ステータスは一覧の「無効化」操作から申請してください。
            </p>
          )}
        </FormField>

        {isItemStructureWfEnabled && (
          <ApplicantDepartmentSelect
            departments={departments}
            value={applicantDepartmentSurrogateId}
            onChange={setApplicantDepartmentSurrogateId}
          />
        )}
      </fieldset>

      <div className="pt-2 flex gap-2">
        <button
          type="submit"
          disabled={!isEditable || isSubmitting || isStructureCurrentlyLocked}
          className={`flex-1 py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
            isEditable && !isSubmitting && !isStructureCurrentlyLocked
              ? isItemStructureWfEnabled
                ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 cursor-pointer"
                : "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          {isSubmitting
            ? isItemStructureWfEnabled
              ? "⏳ 承認申請を送信中..."
              : "処理中..."
            : editingId
              ? isItemStructureWfEnabled
                ? "🔀 変更を申請する"
                : "保存"
              : isItemStructureWfEnabled
                ? "✨ 承認を申請する"
                : "登録"}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={onCancel}
            className="border border-slate-200 text-slate-600 bg-white px-3 py-2 rounded text-xs font-bold hover:bg-slate-50 cursor-pointer"
          >
            キャンセル
          </button>
        )}
      </div>
    </form>
  );
}
