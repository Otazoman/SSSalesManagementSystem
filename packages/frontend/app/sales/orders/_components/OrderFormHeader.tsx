import React from "react";
import { OrderRecord } from "../_types";

interface OrderFormHeaderProps {
  editingId: string | null;
  orderId: string;
  status: OrderRecord["status"];
  isMailSending: boolean;
  onOpenMailModal: () => void;
  onGeneratePDF: (id: string) => void;
}

export function OrderFormHeader({
  editingId,
  orderId,
  status,
  isMailSending,
  onOpenMailModal,
  onGeneratePDF,
}: OrderFormHeaderProps) {
  return (
    <div className="flex justify-between items-center border-b pb-3">
      <h3 className="text-sm font-black text-slate-900">
        {editingId
          ? `📋 受注台帳の詳細・編集 (現在の管理コード: ${orderId})`
          : "➕ 新規受注データの起票"}
      </h3>
      <div className="flex items-center gap-3">
        {editingId && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={status !== "APPROVED" || isMailSending}
              onClick={onOpenMailModal}
              title={status !== "APPROVED" ? "ステータスが承認済みの場合のみメール送信が可能です" : ""}
              className={`font-bold text-xs px-3 py-2 rounded-lg shadow transition-colors ${
                status === "APPROVED"
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                  : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
              }`}
            >
              {isMailSending ? "送信中..." : "📧 注文請書をメール送信"}
            </button>

            <button
              type="button"
              disabled={status !== "APPROVED"}
              onClick={() => onGeneratePDF(orderId)}
              title={status !== "APPROVED" ? "ステータスが承認済みの場合のみPDF発行が可能です" : ""}
              className={`font-bold text-xs px-4 py-2 rounded-lg shadow transition-colors ${
                status === "APPROVED"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                  : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
              }`}
            >
              📄 注文請書PDFを発行
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
