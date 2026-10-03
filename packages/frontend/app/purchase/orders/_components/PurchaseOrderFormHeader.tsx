import React from "react";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";

interface PurchaseOrderFormHeaderProps {
  editingId: string | null;
  editingStatus: string | null;
  isSubmitting: boolean;
  onGeneratePdf: () => void;
  onOpenMailModal: (orderId: string) => void;
}

// J-2-b: sales/quotes/_components/QuoteFormHeader.tsx・sales/orders/_components/OrderFormHeader.tsxと
// 同じ位置(フォーム見出しの右側)・同じ見た目(📧ボタン)にメール送信・PDF発行ボタンを揃えたヘッダー。
// 以前はフォーム下部(明細・添付の後)にインライン配置されていた。
export function PurchaseOrderFormHeader({
  editingId,
  editingStatus,
  isSubmitting,
  onGeneratePdf,
  onOpenMailModal,
}: PurchaseOrderFormHeaderProps) {
  const badge = editingStatus ? getDocumentLifecycleStatus(editingStatus) : null;
  const isApproved = editingStatus === "APPROVED";

  return (
    <div className="flex items-center justify-between border-b pb-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-black text-slate-900">
          {editingId ? `🛒 発注の詳細・編集 (管理番号: ${editingId})` : "➕ 新規発注の起票"}
        </h2>
        {badge && <StatusBadge {...badge} />}
      </div>
      {editingId && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!isApproved || isSubmitting}
            onClick={() => onOpenMailModal(editingId)}
            title={!isApproved ? "ステータスが承認済みの場合のみメール送信が可能です" : ""}
            className={`font-bold text-xs px-3 py-2 rounded-lg shadow transition-colors ${
              isApproved
                ? "bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
            }`}
          >
            📧 発注書をメール送信
          </button>

          <button
            type="button"
            disabled={!isApproved || isSubmitting}
            onClick={onGeneratePdf}
            title={!isApproved ? "ステータスが承認済みの場合のみPDF発行が可能です" : ""}
            className={`font-bold text-xs px-4 py-2 rounded-lg shadow transition-colors ${
              isApproved
                ? "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                : "bg-slate-200 text-slate-600 cursor-not-allowed shadow-none"
            }`}
          >
            📄 発注書PDFを発行
          </button>
        </div>
      )}
    </div>
  );
}
