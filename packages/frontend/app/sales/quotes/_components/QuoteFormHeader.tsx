import React from "react";
import { QuoteRecord } from "../_types";
import { Button } from "../../../_shared/ui/Button";

interface QuoteFormHeaderProps {
  editingId: string | null;
  quoteId: string;
  status: QuoteRecord["status"];
  isMailSending: boolean;
  siblingVersions: QuoteRecord[];
  onOpenEditForm: (id: string) => void;
  onOpenMailModal: () => void;
  onGeneratePDF: (id: string) => void;
}

export function QuoteFormHeader({
  editingId,
  quoteId,
  status,
  isMailSending,
  siblingVersions,
  onOpenEditForm,
  onOpenMailModal,
  onGeneratePDF,
}: QuoteFormHeaderProps) {
  const isApproved = status === "APPROVED";
  return (
    <div className="flex flex-col gap-3 border-b pb-3 lg:flex-row lg:items-start lg:justify-between">
      <h3 className="min-w-0 break-words text-sm font-black text-slate-900">
        {editingId
          ? `📄 見積台帳の詳細・編集 (現在の管理コード: ${quoteId})`
          : "➕ 新規見積発行データの起票"}
      </h3>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {editingId && siblingVersions.length > 1 && (
          <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 text-xs">
            <span className="font-bold text-slate-700">Ver.切替:</span>
            <select
              value={quoteId}
              onChange={(e) => e.target.value && onOpenEditForm(e.target.value)}
              className="text-[11px] font-medium text-indigo-700 bg-white border border-slate-300 rounded px-1.5 py-0.5 focus:outline-none"
            >
              {siblingVersions.map((q) => {
                const parts = q.id.split("-");
                const revNum = parts[parts.length - 1];
                return (
                  <option key={q.id} value={q.id}>
                    枝番: {revNum} (Ver.{revNum})
                  </option>
                );
              })}
            </select>
          </div>
        )}
        {editingId && (
          <>
            {/* メール送信ボタン(単独送信スイッチ) */}
            <Button
              size="sm"
              disabled={!isApproved || isMailSending}
              onClick={onOpenMailModal}
              title={
                !isApproved
                  ? "ステータスが承認済みの場合のみメール送信が可能です"
                  : ""
              }
            >
              {isMailSending ? "送信中..." : "📧 見積書をメール送信"}
            </Button>

            {/* PDF発行ボタン */}
            <Button
              variant="success"
              size="sm"
              disabled={!isApproved}
              onClick={() => onGeneratePDF(quoteId)}
              title={
                !isApproved
                  ? "ステータスが承認済みの場合のみPDF発行が可能です"
                  : ""
              }
            >
              📄 このバージョンのPDF見積書を発行
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
