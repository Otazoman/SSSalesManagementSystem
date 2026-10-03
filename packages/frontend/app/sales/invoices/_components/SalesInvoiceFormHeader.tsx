import React from "react";
import { SalesInvoiceRecord } from "../_types";

interface SalesInvoiceFormHeaderProps {
  editingId: string | null;
  invoiceId: string;
  status: SalesInvoiceRecord["status"];
  // K-4-1
  isMailSending?: boolean;
  onOpenMailModal?: () => void;
  onGeneratePDF: (id: string) => void;
}

export function SalesInvoiceFormHeader({
  editingId,
  invoiceId,
  status,
  isMailSending = false,
  onOpenMailModal,
  onGeneratePDF,
}: SalesInvoiceFormHeaderProps) {
  return (
    <div className="flex justify-between items-center border-b pb-3">
      <h3 className="text-sm font-black text-slate-900">
        {editingId
          ? `📄 売上台帳の詳細・編集 (現在の管理コード: ${invoiceId})`
          : "➕ 新規売上計上データの起票"}
      </h3>
      <div className="flex items-center gap-3">
        {editingId && onOpenMailModal && (
          <button
            type="button"
            disabled={status !== "APPROVED" || isMailSending}
            onClick={onOpenMailModal}
            title={
              status !== "APPROVED"
                ? "ステータスが承認済みの場合のみメール送信が可能です"
                : ""
            }
            className={`font-bold text-xs px-3 py-2 rounded-lg shadow transition-colors ${
              status === "APPROVED"
                ? "bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
            }`}
          >
            {isMailSending ? "送信中..." : "📧 売上計上書を送信"}
          </button>
        )}

        {editingId && (
          <button
            type="button"
            disabled={status !== "APPROVED"}
            onClick={() => onGeneratePDF(invoiceId)}
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
            📄 売上計上書PDFを発行
          </button>
        )}
      </div>
    </div>
  );
}
