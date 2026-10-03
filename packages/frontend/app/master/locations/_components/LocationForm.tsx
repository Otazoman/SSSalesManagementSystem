import React from "react";
import { WarehouseSimple } from "../_types";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface LocationFormProps {
  form: ReturnType<typeof import("../_hooks/useLocationForm").useLocationForm>;
  warehouses: WarehouseSimple[];
  canCreate: boolean;
  canUpdate: boolean;
  isLocationWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onImportCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmitSuccess: () => void;
}

const inputClass = formFieldInputClass;
const disabledInputClass = "";

export function LocationForm({
  form,
  warehouses,
  canCreate,
  canUpdate,
  isLocationWfEnabled = false,
  departments = [],
  onImportCsv,
  onSubmitSuccess,
}: LocationFormProps) {
  const isCsvImportDisabled = !canCreate || isLocationWfEnabled;
  const hasFormPermission = form.editingId ? canUpdate : canCreate;
  const isLocationCurrentlyLocked = form.isLocationCurrentlyLocked;

  const handleFormSubmit = async (e: React.SyntheticEvent) => {
    const success = await form.handleSubmit(e);
    if (success) {
      onSubmitSuccess();
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200">
      <form
        onSubmit={handleFormSubmit}
        className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm"
      >
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
          {form.editingId
            ? "ロケーション情報の編集"
            : "新規個別ロケーション登録"}
        </h3>

        {!hasFormPermission && (
          <p className="text-[10px] text-red-500 font-bold bg-red-50 p-1.5 rounded border border-red-100">
            ⚠️ データを登録・編集する権限がありません。
          </p>
        )}

        {isLocationCurrentlyLocked && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-black rounded-lg flex items-center space-x-2">
            <span>🔒</span>
            <span>
              このデータは現在、承認ワークフローの審査中(仮登録)のため、承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます。
            </span>
          </div>
        )}

        <fieldset
          disabled={!hasFormPermission || isLocationCurrentlyLocked}
          className="space-y-4 w-full"
        >
          <FormField label="所属倉庫" required>
            <select
              required
              className={`${inputClass} ${disabledInputClass} cursor-pointer`}
              value={form.locWarehouseId}
              onChange={(e) => form.setLocWarehouseId(e.target.value)}
            >
              <option value="">-- 倉庫を選択してください --</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="ロケーションコード" required>
              <input
                type="text"
                required
                disabled={!!form.editingId}
                className={`${inputClass} ${disabledInputClass}`}
                placeholder="例: LOC-A-01"
                value={form.locId}
                onChange={(e) => form.setLocId(e.target.value)}
              />
            </FormField>
            <FormField label="ロケーション名称" required>
              <input
                type="text"
                required
                className={`${inputClass} ${disabledInputClass}`}
                placeholder="例: A棚 1段目"
                value={form.locName}
                onChange={(e) => form.setLocName(e.target.value)}
              />
            </FormField>
          </div>

          <FormField label="備考・メモ">
            <textarea
              className={`${inputClass} ${disabledInputClass} h-20 resize-none`}
              placeholder="特記事項を入力"
              value={form.locMemo}
              onChange={(e) => form.setLocMemo(e.target.value)}
            />
          </FormField>

          <div>
            <label className="block text-[9px] font-bold text-slate-600 mb-0.5">
              ステータス
            </label>
            <select
              disabled={isLocationWfEnabled}
              className={`${inputClass} ${isLocationWfEnabled ? "bg-slate-100 text-slate-500 cursor-not-allowed" : "cursor-pointer"}`}
              value={form.locStatus}
              onChange={(e) => form.setLocStatus(e.target.value)}
            >
              <option value="active">有効</option>
              <option value="temporary">仮登録</option>
              <option value="suspended">無効</option>
            </select>
            {isLocationWfEnabled && (
              <p className="text-[9px] text-indigo-600 font-bold mt-1">
                🛡️
                承認機能有効化のため、ステータス変更はワークフロー審査で行います。
              </p>
            )}
          </div>

          {isLocationWfEnabled && (
            <ApplicantDepartmentSelect
              departments={departments}
              value={form.applicantDepartmentSurrogateId}
              onChange={form.setApplicantDepartmentSurrogateId}
            />
          )}
        </fieldset>

        {form.editingId ? (
          isLocationWfEnabled ? (
            <button
              type="submit"
              disabled={isLocationCurrentlyLocked}
              className={`w-full py-2 rounded text-xs font-bold shadow-sm transition-colors ${
                !isLocationCurrentlyLocked
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white cursor-pointer"
                  : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
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
                  : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
              }`}
            >
              保存
            </button>
          )
        ) : isLocationWfEnabled ? (
          <button
            type="submit"
            disabled={!hasFormPermission}
            className={`w-full py-2.5 rounded-lg text-xs font-black shadow-md transition-all duration-200 ${
              hasFormPermission
                ? "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white cursor-pointer hover:shadow-lg active:scale-[0.99]"
                : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
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
                : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
            }`}
          >
            マスタに登録を実行
          </button>
        )}
      </form>

      {/* CSVインポートエリア */}
      {!form.editingId && (
        <div className="bg-white p-5 rounded-lg flex flex-col justify-between border border-slate-200 shadow-sm">
          <div>
            <div className="flex justify-between items-center border-b pb-1 mb-2">
              <h3 className="text-xs font-bold text-slate-900">
                ロケーションCSV一括インポート
              </h3>
              {isLocationWfEnabled && (
                <span className="text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
                  ※承認機能が有効な間は利用できません
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              右記ヘッダーに準拠したCSVファイルを選択してください：
              <code className="bg-slate-100 border border-slate-200 text-slate-700 p-1 rounded block mt-1 font-mono text-[9px]">
                id,warehouseId,name,status,memo
              </code>
              statusは省略可(省略時は&quot;active&quot;として登録されます)
            </p>
          </div>

          <label
            className={`border-2 border-dashed rounded p-6 block text-center transition-colors ${
              !isCsvImportDisabled
                ? "border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer"
                : "border-slate-200 bg-slate-100 text-slate-600 cursor-not-allowed"
            }`}
          >
            <span
              className={`text-xs font-bold ${
                !isCsvImportDisabled ? "text-slate-700" : "text-slate-600"
              }`}
            >
              {!isCsvImportDisabled
                ? "ロケーションCSVファイルを選択"
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
