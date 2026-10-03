// app/products/_components/CsvImportPanel.tsx
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";

interface CsvImportPanelProps {
  canCreate: boolean;
  isProductWfEnabled?: boolean;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  onImportComplete: () => void;
}

export function CsvImportPanel({
  canCreate,
  isProductWfEnabled = false,
  onSuccess,
  onError,
  onImportComplete,
}: CsvImportPanelProps) {
  const { importCsv } = useCsvImport({
    onSuccess: onImportComplete,
    onMessage: onSuccess,
    onError,
  });

  const isAllowed = canCreate && !isProductWfEnabled;

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAllowed) return;
    await importCsv("/api/products/bulk-register", e);
  };

  return (
    <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
      <div>
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1 mb-2">
          📦 品目マスタ CSV一括インポート
        </h3>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          ヘッダー定義順：
          <code className="bg-slate-100 border border-slate-200 text-slate-700 p-1.5 rounded block mt-2 font-mono text-[9px] overflow-x-auto whitespace-nowrap">
            id,name,isPurchased,isSales,isService,baseUnitCode,taxCategoryCode,productBarcode,accountCode,standardSalesPrice,standardPurchasePrice,memo,status,supplierId,supplierPartNumber
          </code>
        </p>
        {isProductWfEnabled && (
          <p className="text-[10px] text-amber-600 font-bold mt-2">
            ※承認機能が有効な間は利用できません
          </p>
        )}
      </div>

      <label
        className={`border-2 border-dashed border-slate-300 rounded-xl p-8 block text-center mt-4 transition-colors ${isAllowed ? "cursor-pointer hover:bg-slate-100 bg-slate-50" : "cursor-not-allowed bg-slate-100 opacity-60"}`}
      >
        <span className="text-xs font-bold text-slate-700 block">
          📁 品目一括同期用CSVファイルを選択
        </span>
        <span className="text-[10px] text-slate-600 block mt-1">
          {isAllowed
            ? "※クリックしてパソコンからファイルを選択してください"
            : !canCreate
              ? "⚠️ CSVインポートする権限がありません"
              : "⚠️ 承認機能が有効な間は利用できません"}
        </span>
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleImportCsv}
          disabled={!isAllowed}
        />
      </label>
    </div>
  );
}
