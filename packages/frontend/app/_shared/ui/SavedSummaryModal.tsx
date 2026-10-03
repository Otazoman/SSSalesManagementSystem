import React from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface SavedSummary {
  id: string;
  title: string;
  partnerName: string;
  totalAmount: number;
}

interface SavedSummaryModalProps {
  /** 例: "受注データを保存しました" */
  title: string;
  warning?: string;
  /** 例: "受注管理コード" */
  codeLabel: string;
  /** 例: "得意先名" / "仕入先名" */
  partnerLabel: string;
  summary: SavedSummary;
  /** 例: "👁️ 保存した受注をプレビューで確認" */
  previewLabel: string;
  /** 「このまま承認申請する」等。省略するとボタンを出さない */
  approveLabel?: string;
  onPreview: () => void;
  onApprove?: () => void;
  onContinue: () => void;
  onBackToList: () => void;
}

/**
 * 伝票(見積・受注・売上・仕入)の保存直後に出す「ワンクッション確認」モーダルの共通部品。
 * 保存した内容の要約と、次の操作(プレビュー・承認申請/確定・編集を続ける・一覧へ戻る)を選ばせる。
 */
export function SavedSummaryModal({
  title,
  warning,
  codeLabel,
  partnerLabel,
  summary,
  previewLabel,
  approveLabel,
  onPreview,
  onApprove,
  onContinue,
  onBackToList,
}: SavedSummaryModalProps) {
  return (
    <Modal
      title={<span className="text-emerald-700">✅ {title}</span>}
      onClose={onContinue}
    >
      <p className="text-[11px] text-slate-600">
        内容をご確認の上、次の操作を選択してください。
      </p>

      {warning && (
        <div className="p-2.5 bg-amber-50 text-amber-800 text-[11px] font-semibold rounded border border-amber-200">
          ⚠️ {warning}
        </div>
      )}

      <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200/80 space-y-2 text-xs">
        <div className="flex justify-between items-center gap-3">
          <span className="text-slate-600 font-medium shrink-0">
            {codeLabel}
          </span>
          <span className="font-mono font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200 truncate">
            {summary.id}
          </span>
        </div>
        <div className="flex justify-between items-center gap-3">
          <span className="text-slate-600 font-medium shrink-0">件名</span>
          <span className="font-bold text-slate-800 truncate">
            {summary.title}
          </span>
        </div>
        <div className="flex justify-between items-center gap-3">
          <span className="text-slate-600 font-medium shrink-0">
            {partnerLabel}
          </span>
          <span className="font-bold text-slate-800 truncate">
            {summary.partnerName}
          </span>
        </div>
        <div className="flex justify-between items-center gap-3 border-t border-slate-200/60 pt-1.5">
          <span className="text-slate-600 font-medium shrink-0">
            合計金額 (税込)
          </span>
          <span className="font-mono font-black text-indigo-700 text-sm">
            ¥{summary.totalAmount.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 pt-1">
        <Button variant="secondary" fullWidth onClick={onPreview}>
          {previewLabel}
        </Button>
        {approveLabel && onApprove && (
          <Button fullWidth onClick={onApprove}>
            {approveLabel}
          </Button>
        )}
        <Button variant="secondary" fullWidth onClick={onContinue}>
          ✏️ このまま編集を続ける
        </Button>
        <Button variant="secondary" fullWidth onClick={onBackToList}>
          ↩ 一覧画面へ戻る
        </Button>
      </div>
    </Modal>
  );
}
