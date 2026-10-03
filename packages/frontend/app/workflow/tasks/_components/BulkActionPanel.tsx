import React from "react";
import { Button } from "../../../_shared/ui/Button";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface BulkActionPanelProps {
  selectedCount: number;
  bulkComment: string;
  isProcessing: boolean;
  onCommentChange: (value: string) => void;
  onBulkAction: (actionType: "bulk-approve" | "bulk-remand") => void;
}

export function BulkActionPanel({
  selectedCount,
  bulkComment,
  isProcessing,
  onCommentChange,
  onBulkAction,
}: BulkActionPanelProps) {
  return (
    <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex flex-col gap-2 text-xs md:flex-row md:items-center md:gap-3">
        <span className="font-bold text-slate-700">
          ⚡ 選択済み:{" "}
          <strong className="text-indigo-700 font-extrabold">
            {selectedCount}
          </strong>{" "}
          件
        </span>
        <input
          type="text"
          className={`${formFieldInputClass} md:w-64`}
          placeholder="一括処理時のコメント(任意)"
          value={bulkComment}
          onChange={(e) => onCommentChange(e.target.value)}
          disabled={isProcessing}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 md:flex">
        <Button
          variant="success"
          onClick={() => onBulkAction("bulk-approve")}
          disabled={selectedCount === 0 || isProcessing}
        >
          🚀 一括承認する
        </Button>
        <Button
          variant="danger"
          onClick={() => onBulkAction("bulk-remand")}
          disabled={selectedCount === 0 || isProcessing}
        >
          ↩️ 一括差戻しする
        </Button>
      </div>
    </div>
  );
}
