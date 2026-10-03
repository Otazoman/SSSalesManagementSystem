import React from "react";
import { PurchaseRecognitionRecord } from "../_types";

interface PurchaseRecognitionFormHeaderProps {
  editingId: string | null;
  recognitionId: string;
  status: PurchaseRecognitionRecord["status"];
  onGeneratePDF: (id: string) => void;
}

export function PurchaseRecognitionFormHeader({
  editingId,
  recognitionId,
  status,
  onGeneratePDF,
}: PurchaseRecognitionFormHeaderProps) {
  return (
    <div className="flex justify-between items-center border-b pb-3">
      <h3 className="text-sm font-black text-slate-900">
        {editingId
          ? `📄 仕入台帳の詳細・編集 (現在の管理コード: ${recognitionId})`
          : "➕ 新規仕入計上データの起票"}
      </h3>
      <div className="flex items-center gap-3">
        {editingId && (
          <button
            type="button"
            disabled={status !== "APPROVED"}
            onClick={() => onGeneratePDF(recognitionId)}
            title={
              status !== "APPROVED"
                ? "ステータスが承認済みの場合のみPDF発行が可能です"
                : ""
            }
            className={`font-bold text-xs px-4 py-2 rounded-lg shadow transition-colors ${
              status === "APPROVED"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
            }`}
          >
            📄 仕入計上書PDFを発行
          </button>
        )}
      </div>
    </div>
  );
}
