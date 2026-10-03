"use client";

interface CsvImportPanelProps {
  canCreate: boolean;
  editingId: string | null;
  isSubmitting?: boolean;
  onImportCsv: (file: File) => Promise<void>;
}

export function CsvImportPanel({
  canCreate,
  editingId,
  isSubmitting = false,
  onImportCsv,
}: CsvImportPanelProps) {
  const isEnabled = canCreate && !editingId && !isSubmitting;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isEnabled) return;
    await onImportCsv(file);
    e.target.value = "";
  };

  return (
    <div className="bg-white p-5 rounded-lg flex flex-col justify-between border border-slate-200 shadow-sm">
      <div>
        <div className="flex justify-between items-center border-b pb-1 mb-2">
          <h3 className="text-xs font-bold text-slate-900">
            業務ロールCSV一括インポート
          </h3>
          {editingId && (
            <span className="text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
              ※編集中は利用できません
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          ヘッダー行を含むCSVファイルを選択してください：
          <code className="bg-slate-100 border border-slate-200 text-slate-700 p-1 rounded block mt-1 font-mono text-[8px] overflow-x-auto whitespace-nowrap">
            id,name,description
          </code>
        </p>
      </div>

      <label
        className={`border-2 border-dashed rounded p-6 block text-center mt-4 transition-colors ${
          isEnabled
            ? "border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer"
            : "border-slate-200 bg-slate-100 text-slate-600 cursor-not-allowed"
        }`}
      >
        <span
          className={`text-xs font-bold ${
            isEnabled ? "text-slate-700" : "text-slate-600"
          }`}
        >
          {isSubmitting
            ? "処理中..."
            : editingId
              ? "インポート不可"
              : canCreate
                ? "業務ロールCSVファイルを選択"
                : "🔒 CSVインポートする権限がありません"}
        </span>
        <input
          type="file"
          accept=".csv"
          className="hidden"
          disabled={!isEnabled}
          onChange={handleFileChange}
        />
      </label>
    </div>
  );
}
