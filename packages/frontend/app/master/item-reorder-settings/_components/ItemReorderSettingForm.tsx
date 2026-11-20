import { ItemReorderSettingRecord, ItemLookup, WarehouseLookup } from "../_types";
import { useItemReorderSettingForm } from "../_hooks/useItemReorderSettingForm";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface Props {
  initialData: ItemReorderSettingRecord | null;
  items: ItemLookup[];
  warehouses: WarehouseLookup[];
  canCreate: boolean;
  canUpdate: boolean;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  onClear: () => void;
  // BUG-098: 承認 ON の時は「申請」になり、承認待ちの間は編集できない
  isWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId?: string | null;
  setApplicantDepartmentSurrogateId?: (id: string) => void;
}

export function ItemReorderSettingForm({
  initialData,
  items,
  warehouses,
  canCreate,
  canUpdate,
  onSuccess,
  onError,
  onClear,
  isWfEnabled = false,
  departments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
}: Props) {
  const {
    itemId,
    setItemId,
    warehouseId,
    setWarehouseId,
    reorderPoint,
    setReorderPoint,
    safetyStock,
    setSafetyStock,
    memo,
    setMemo,
    handleSubmit,
    isLocked,
  } = useItemReorderSettingForm(initialData, canCreate, canUpdate, onSuccess, onError, {
    isWfEnabled,
    applicantDepartmentSurrogateId,
  });

  const isEditable = (initialData ? canUpdate : canCreate) && !isLocked;
  const inputClass = formFieldInputClass;

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-6 rounded-xl border border-slate-200 space-y-4 shadow-sm relative"
    >
      {!isEditable && (
        <div className="absolute top-2 right-4 text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded">
          閲覧専用
        </div>
      )}

      <fieldset disabled={!isEditable} className="space-y-4">
        <h3 className="font-bold text-xs text-slate-900 border-b border-slate-100 pb-2">
          {initialData ? "発注点/安全在庫の編集" : "新規発注点/安全在庫の追加"}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">品目 *</label>
            <select
              required
              disabled={!!initialData}
              className={`${inputClass} cursor-pointer`}
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            >
              <option value="">-- 品目選択 --</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  [{i.id}] {i.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">倉庫 *</label>
            <select
              required
              disabled={!!initialData}
              className={`${inputClass} cursor-pointer`}
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">-- 倉庫選択 --</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  [{w.id}] {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">発注点 *</label>
            <input
              type="number"
              min={0}
              required
              className={inputClass}
              value={reorderPoint}
              onChange={(e) => setReorderPoint(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">安全在庫 *</label>
            <input
              type="number"
              min={0}
              required
              className={inputClass}
              value={safetyStock}
              onChange={(e) => setSafetyStock(Number(e.target.value))}
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-600 mb-1">メモ</label>
          <input
            type="text"
            className={inputClass}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
        {isLocked && (
          <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            🔒 承認待ちのため、承認されるか差し戻されるまで変更できません
          </p>
        )}
        {isWfEnabled && (
          <ApplicantDepartmentSelect
            departments={departments}
            value={applicantDepartmentSurrogateId}
            onChange={setApplicantDepartmentSurrogateId}
          />
        )}
      </fieldset>
      <div className="flex space-x-2 pt-2">
        <button
          type="submit"
          disabled={!isEditable}
          className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
            isEditable
              ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          {isWfEnabled ? (initialData ? "変更を申請" : "仮登録して申請") : "保存する"}
        </button>
        {initialData && (
          <button
            type="button"
            onClick={onClear}
            className="w-1/3 bg-slate-200 text-slate-700 py-2 rounded text-xs font-bold hover:bg-slate-300 transition-colors cursor-pointer"
          >
            取消
          </button>
        )}
      </div>
    </form>
  );
}
