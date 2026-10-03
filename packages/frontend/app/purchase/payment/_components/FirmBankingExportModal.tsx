import React from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { FirmBankingPreviewResult } from "../_hooks/usePaymentActions";

interface FirmBankingExportModalProps {
  isOpen: boolean;
  selectedCount: number;
  transferDate: string;
  setTransferDate: (value: string) => void;
  preview: FirmBankingPreviewResult | null;
  isLoading: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onClose: () => void;
}

// ファームバンキング: 選択した支払から全銀協会「総合振込」フォーマットの振込データファイルを
// 作成する。ダウンロード前に必ず件数・合計金額・変換警告を確認できるようにする(誤った金額・
// 件数のファイルをそのまま銀行に提出してしまうことを防ぐための一手間)
export function FirmBankingExportModal({
  isOpen,
  selectedCount,
  transferDate,
  setTransferDate,
  preview,
  isLoading,
  onPreview,
  onDownload,
  onClose,
}: FirmBankingExportModalProps) {
  if (!isOpen) return null;

  return (
    <Modal title="🏦 ファームバンキングデータ作成" size="lg" onClose={onClose}>
      <p className="text-xs text-slate-600">
        選択した支払{" "}
        <span className="font-bold text-indigo-600">{selectedCount}</span>{" "}
        件から、全銀協会「総合振込」フォーマットの振込データファイルを作成します。金額は各支払の未消込残額です。
      </p>

      <div className="flex flex-col space-y-1">
        <label className="text-[10px] font-bold text-slate-600">
          取組日(振込指定日)*
        </label>
        <input
          type="date"
          className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50"
          value={transferDate}
          onChange={(e) => setTransferDate(e.target.value)}
        />
      </div>

      {preview && (
        <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-slate-600 font-bold block">対象件数</span>
              <span className="font-mono font-bold text-slate-800">
                {preview.recordCount} 件
              </span>
            </div>
            <div>
              <span className="text-slate-600 font-bold block">合計金額</span>
              <span className="font-mono font-bold text-indigo-600">
                ¥{preview.totalAmount.toLocaleString()}
              </span>
            </div>
          </div>
          {preview.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 text-amber-700 text-[11px] font-bold rounded px-2 py-1.5 space-y-1">
              <p>
                ⚠️
                以下の警告があります(全角文字がスペースに置換されている可能性があります):
              </p>
              <ul className="list-disc list-inside">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-slate-500">
        ※
        生成されるファイルの項目仕様は標準的な全銀フォーマットに基づいています。実際の振込にご利用の際は、必ず取引銀行のファームバンキングソフトのテスト読み込み・検証機能で事前確認してください。
      </p>

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
        >
          キャンセル
        </button>
        <Button onClick={onPreview} disabled={isLoading || !transferDate}>
          {isLoading ? "確認中..." : "内容を確認する"}
        </Button>
        <Button onClick={onDownload} disabled={isLoading || !preview}>
          {isLoading ? "作成中..." : "📥 ダウンロード"}
        </Button>
      </div>
    </Modal>
  );
}
