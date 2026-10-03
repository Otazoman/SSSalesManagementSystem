"use client";

import { UnitRecord } from "../_types";

interface UnitCsvImportProps {
  canCreate: boolean;
  editingUnit?: UnitRecord | null;
  isSubmitting?: boolean;
  isUnitWfEnabled?: boolean;
  onImportCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function UnitCsvImport({
  canCreate,
  editingUnit = null,
  isSubmitting = false,
  isUnitWfEnabled = false,
  onImportCsv,
}: UnitCsvImportProps) {
  const isImportDisabled =
    !canCreate || !!editingUnit || isSubmitting || isUnitWfEnabled;

  return (
    <div className="bg-white p-5 rounded-lg flex flex-col justify-between border border-slate-200 shadow-sm">
      <div>
        <div className="flex justify-between items-center border-b pb-1 mb-2">
          <h3 className="text-xs font-bold text-slate-900">
            単位CSV一括インポート
          </h3>
          {editingUnit && (
            <span className="text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
              ※編集中は利用できません
            </span>
          )}
          {!editingUnit && isUnitWfEnabled && (
            <span className="text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
              ※承認機能が有効な間は利用できません
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-600 leading-relaxed">
          右記ヘッダーに準拠したCSVファイルを選択してください(status は任意。active・temporary・suspended)：
          <code className="bg-slate-100 border border-slate-200 text-slate-700 p-1 rounded block mt-1 font-mono text-[8px] overflow-x-auto whitespace-nowrap">
            code,name,status
          </code>
        </p>
      </div>

      <label
        className={`border-2 border-dashed rounded p-6 block text-center mt-4 transition-colors ${
          !isImportDisabled
            ? "border-slate-300 bg-slate-50 cursor-pointer hover:bg-slate-100"
            : "border-slate-200 bg-slate-100 cursor-not-allowed"
        }`}
      >
        <span
          className={`text-xs font-bold ${
            !isImportDisabled ? "text-slate-700" : "text-slate-500"
          }`}
        >
          {isSubmitting
            ? "処理中..."
            : !isImportDisabled
              ? "単位CSVファイルを選択"
              : "インポート不可"}
        </span>
        <input
          type="file"
          accept=".csv"
          className="hidden"
          disabled={isImportDisabled}
          onChange={onImportCsv}
        />
      </label>
    </div>
  );
}
