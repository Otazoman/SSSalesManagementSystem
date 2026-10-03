"use client";

import { useCsvImport } from "../../../_shared/hooks/use-csv-import";

interface CsvImportPanelProps {
  canCreate: boolean;
  editingId: string | null;
  isPartnerWfEnabled: boolean;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export default function CsvImportPanel({
  canCreate,
  editingId,
  isPartnerWfEnabled,
  onSuccess,
  onError,
}: CsvImportPanelProps) {
  const { importCsv, importing: isSubmitting } = useCsvImport({
    onSuccess,
    onError,
  });

  const isDisabled =
    !canCreate || !!editingId || isSubmitting || isPartnerWfEnabled;

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isDisabled) return;
    await importCsv("/api/partners/bulk-register", e);
  };

  return (
    <div className="bg-white p-5 rounded-lg flex flex-col justify-between border border-slate-200 shadow-sm">
      <div>
        <div className="flex justify-between items-center border-b pb-1 mb-2">
          <h3 className="text-xs font-bold text-slate-900">
            取引先CSV一括インポート
          </h3>
          {editingId && (
            <span className="text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
              ※編集中は利用できません
            </span>
          )}
          {!editingId && isPartnerWfEnabled && (
            <span className="text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
              ※承認機能が有効な間は利用できません
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-700 leading-relaxed">
          右記ヘッダーに準拠したCSVファイルを選択してください(決済条件カラムは空欄も許容されます)：
          <code className="bg-slate-100 border border-slate-200 text-slate-800 p-1 rounded block mt-1 font-mono text-[8px] overflow-x-auto whitespace-nowrap">
            id,name,type,postalCode,address,phone,fax,creditLimit,closingDay,paymentMonthOffset,paymentDay,paymentMethod,status,memo,qualifiedInvoiceNumber,corporateNumber
          </code>
          <span className="block mt-1">
            末尾2列(適格事業者番号=「T」+13桁、法人番号=13桁)を省いた従来の14列形式も受け付けます(その場合、既存の番号は変更されません)。
          </span>
        </p>
      </div>

      <label
        className={`border-2 border-dashed rounded p-6 block text-center mt-4 transition-colors ${!isDisabled ? "border-slate-300 bg-slate-50 cursor-pointer hover:bg-slate-100" : "border-slate-200 bg-slate-100 cursor-not-allowed"}`}
      >
        <span
          className={`text-xs font-bold ${!isDisabled ? "text-slate-700" : "text-slate-600"}`}
        >
          {isSubmitting
            ? "処理中..."
            : !isDisabled
              ? "取引先CSVファイルを選択"
              : "インポート不可"}
        </span>
        <input
          type="file"
          accept=".csv"
          className="hidden"
          disabled={isDisabled}
          onChange={handleImportCsv}
        />
      </label>
    </div>
  );
}
