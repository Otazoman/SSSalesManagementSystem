"use client";

interface Props {
  canCreate: boolean;
  isSubmitting?: boolean;
  onImportCsv: (e: React.ChangeEvent<HTMLInputElement>) => void;
  // BUG-098: 承認 ON の間は CSV で取り込めない(サーバーも拒否する)
  isWfEnabled?: boolean;
}

export function ItemReorderSettingCsvImport({ canCreate, isSubmitting = false, onImportCsv, isWfEnabled = false }: Props) {
  const isImportDisabled = !canCreate || isSubmitting || isWfEnabled;

  return (
    <div className="bg-white p-5 rounded-lg flex flex-col justify-between border border-slate-200 shadow-sm">
      <div>
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1 mb-2">
          発注点/安全在庫CSV一括インポート
          {isWfEnabled && (
            <span className="ml-2 text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
              ※承認機能が有効な間は利用できません
            </span>
          )}
        </h3>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          右記ヘッダーに準拠したCSVファイルを選択してください(品目×倉庫が既存の場合は上書き更新されます)：
          <code className="bg-slate-100 border border-slate-200 text-slate-700 p-1 rounded block mt-1 font-mono text-[8px] overflow-x-auto whitespace-nowrap">
            itemId,warehouseId,reorderPoint,safetyStock,memo
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
        <span className={`text-xs font-bold ${!isImportDisabled ? "text-slate-700" : "text-slate-600"}`}>
          {isSubmitting ? "処理中..." : !isImportDisabled ? "CSVファイルを選択" : "インポート不可"}
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
