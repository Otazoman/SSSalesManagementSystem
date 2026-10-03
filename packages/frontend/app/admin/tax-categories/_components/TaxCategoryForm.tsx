import { TaxCategoryRecord } from "../_types";
import { useTaxCategoryForm } from "../_hooks/useTaxCategoryForm";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface Props {
  initialData: TaxCategoryRecord | null;
  canCreate: boolean;
  canUpdate: boolean;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  onClear: () => void;
}

export function TaxCategoryForm({
  initialData,
  canCreate,
  canUpdate,
  onSuccess,
  onError,
  onClear,
}: Props) {
  const {
    code,
    setCode,
    name,
    setName,
    taxType,
    setTaxType,
    taxRate,
    setTaxRate,
    handleSubmit,
  } = useTaxCategoryForm(initialData, canCreate, canUpdate, onSuccess, onError);

  const isEditable = initialData ? canUpdate : canCreate;
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
          {initialData ? "消費税区分の編集" : "新規消費税区分の追加"}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">
              区分コード *
            </label>
            <input
              type="text"
              required
              disabled={!!initialData}
              placeholder="例: TAX_10"
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">
              区分名称 *
            </label>
            <input
              type="text"
              required
              placeholder="例: 10%標準税率"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">
              税別タイプ *
            </label>
            <select
              className={`${inputClass} cursor-pointer font-bold`}
              value={taxType}
              onChange={(e) => setTaxType(e.target.value as any)}
            >
              <option value="STANDARD">標準/指定税率 (STANDARD)</option>
              <option value="EXEMPT">非課税 (EXEMPT)</option>
              <option value="VARIABLE">可変/手入力 (VARIABLE)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1">
              税率 (小数表記) *
            </label>
            <input
              type="number"
              step="0.01"
              required
              disabled={taxType === "EXEMPT"}
              placeholder="0.10"
              className={inputClass}
              value={taxType === "EXEMPT" ? 0 : taxRate}
              onChange={(e) => setTaxRate(Number(e.target.value))}
            />
          </div>
        </div>
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
          保存する
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
