"use client";

import { Button } from "../../../_shared/ui/Button";
interface TemplateToolProps {
  canUpdate: boolean;
  copiedRoleName: string;
  hasCopiedTemplate: boolean;
  onCopy: () => void;
  onPaste: () => void;
}

export function TemplateTool({
  canUpdate,
  copiedRoleName,
  hasCopiedTemplate,
  onCopy,
  onPaste,
}: TemplateToolProps) {
  return (
    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
      <h3 className="text-xs font-bold text-slate-900 border-b pb-2">
        📋 画面内ひな型コピーツール
      </h3>
      <p className="text-[10px] text-slate-500 leading-normal">
        現在のロールのチェック状態を一時記憶し、他のロールに丸ごとコピーできます。
      </p>
      <div className="space-y-2 pt-1">
        <Button className="w-full" onClick={onCopy} disabled={!canUpdate}>
          ステップ①: 現在のマトリクスをコピー
        </Button>
        <div className="text-center text-[10px] text-slate-600 font-bold py-0.5">
          ▼ 選択ロール切り替え後に実行 ▼
        </div>
        <button
          type="button"
          onClick={onPaste}
          disabled={!hasCopiedTemplate || !canUpdate}
          className={`w-full bg-indigo-50 text-indigo-700 border border-indigo-200 py-2 rounded text-xs font-bold hover:bg-indigo-100 transition-colors shadow-sm ${
            !hasCopiedTemplate || !canUpdate
              ? "opacity-40 cursor-not-allowed"
              : "cursor-pointer"
          }`}
        >
          ステップ②: ひな型を貼り付け
        </button>
        {copiedRoleName && (
          <p className="text-[9px] text-emerald-600 font-medium text-center mt-1">
            ※現在「{copiedRoleName}」のひな型データを保持中
          </p>
        )}
      </div>
    </div>
  );
}
