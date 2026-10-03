"use client";

import { useState } from "react";

interface CsvImportPanelProps {
  title: string;
  headerFormat: string;
  canCreate: boolean;
  editingId: string | null;
  isWarehouseWfEnabled?: boolean;
  onImport: (file: File) => Promise<void>;
}

export default function CsvImportPanel({
  title,
  headerFormat,
  canCreate,
  editingId,
  isWarehouseWfEnabled = false,
  onImport,
}: CsvImportPanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isAllowed =
    canCreate && !editingId && !isSubmitting && !isWarehouseWfEnabled;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAllowed) return;
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSubmitting(true);
    try {
      await onImport(file);
    } finally {
      e.target.value = "";
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-5 rounded-lg flex flex-col justify-between border border-slate-200 shadow-sm">
      <div>
        <div className="flex justify-between items-center border-b pb-1 mb-2">
          <h3 className="text-xs font-bold text-slate-900">
            {title} CSV一括インポート
          </h3>
          {editingId && (
            <span className="text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
              ※編集中は利用できません
            </span>
          )}
          {!editingId && isWarehouseWfEnabled && (
            <span className="text-[9px] bg-amber-50 text-amber-700 px-1 rounded font-medium">
              ※承認機能が有効な間は利用できません
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          下記ヘッダーに準拠したCSVファイルを選択してください：
          <code className="bg-slate-100 border border-slate-200 text-slate-700 p-1 rounded block mt-1 font-mono text-[8px] overflow-x-auto whitespace-nowrap">
            {headerFormat}
          </code>
        </p>
      </div>

      <label
        className={`border-2 border-dashed rounded p-6 block text-center mt-4 transition-colors ${
          isAllowed
            ? "border-slate-300 bg-slate-50 cursor-pointer hover:bg-slate-100"
            : "border-slate-200 bg-slate-100 cursor-not-allowed"
        }`}
      >
        <span
          className={`text-xs font-bold ${
            isAllowed ? "text-slate-700" : "text-slate-500"
          }`}
        >
          {isSubmitting
            ? "処理中..."
            : isAllowed
              ? "CSVファイルを選択"
              : "インポート不可"}
        </span>
        <input
          type="file"
          accept=".csv"
          className="hidden"
          disabled={!isAllowed}
          onChange={handleFileChange}
        />
      </label>
    </div>
  );
}
