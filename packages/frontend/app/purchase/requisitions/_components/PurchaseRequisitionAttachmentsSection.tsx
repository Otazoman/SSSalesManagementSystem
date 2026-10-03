import React from "react";
import { PurchaseRequisitionAttachment } from "../_types";

interface PurchaseRequisitionAttachmentsSectionProps {
  requisitionId: string;
  attachments: PurchaseRequisitionAttachment[];
  isLocked: boolean;
  onAddAttachmentRow: (storageType: "R2" | "GOOGLE_DRIVE") => void;
  onRemoveAttachmentRow: (index: number, fileName: string) => void;
  onFileSelection: (
    index: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => void;
  onFileNameChange: (index: number, value: string) => void;
  onExternalUrlChange: (index: number, value: string) => void;
}

// QuoteAttachmentsSection.tsxと同じ「R2ファイル選択/共有リンク貼付」両対応のUI
const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500";

export function PurchaseRequisitionAttachmentsSection({
  requisitionId,
  attachments,
  isLocked,
  onAddAttachmentRow,
  onRemoveAttachmentRow,
  onFileSelection,
  onFileNameChange,
  onExternalUrlChange,
}: PurchaseRequisitionAttachmentsSectionProps) {
  return (
    <div className="space-y-3 pt-2 border-t border-slate-100">
      <div className="flex justify-between items-center">
        <div>
          <label className="text-xs font-bold text-slate-700 block">
            📎 参考添付ファイルの管理
          </label>
          <span className="text-[10px] text-slate-600 block">
            見積依頼書等をR2へバイナリ保存、または外部リンクで指定
          </span>
        </div>
        <div className="space-x-1.5">
          <button
            type="button"
            onClick={() => onAddAttachmentRow("R2")}
            disabled={isLocked}
            className="text-[10px] bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-2 py-1 rounded hover:bg-indigo-100 disabled:opacity-50"
          >
            📂 PCからファイル選択
          </button>
          <button
            type="button"
            onClick={() => onAddAttachmentRow("GOOGLE_DRIVE")}
            disabled={isLocked}
            className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold px-2 py-1 rounded hover:bg-emerald-100 disabled:opacity-50"
          >
            🔗 共有リンク貼付
          </button>
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((att, idx) => (
            <div
              key={idx}
              className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs"
            >
              <span
                className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${att.storageType === "R2" ? "bg-indigo-600 text-white" : "bg-emerald-600 text-white"}`}
              >
                {att.storageType === "R2" ? "R2保存" : "外部リンク"}
              </span>
              {att.storageType === "R2" ? (
                <div className="w-full sm:w-1/3 flex items-center gap-2">
                  {att.attachmentR2Path ? (
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-800">
                        {att.fileName}
                      </span>
                      <a
                        href={`/api/purchase-requisitions/download/${requisitionId}/${att.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-indigo-600 hover:underline font-bold mt-0.5"
                      >
                        📥 ダウンロード / 表示
                      </a>
                    </div>
                  ) : (
                    <input
                      type="file"
                      required={!att.fileName}
                      disabled={isLocked}
                      className={inputClass}
                      onChange={(e) => onFileSelection(idx, e)}
                    />
                  )}
                </div>
              ) : (
                <div className="w-full sm:w-1/3">
                  <input
                    type="text"
                    required
                    disabled={isLocked}
                    placeholder="表示用のファイル名"
                    className={inputClass}
                    value={att.fileName}
                    onChange={(e) => onFileNameChange(idx, e.target.value)}
                  />
                </div>
              )}

              {att.storageType !== "R2" && (
                <div className="w-full sm:flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    required
                    disabled={isLocked}
                    placeholder="https://..."
                    className={inputClass}
                    value={att.externalUrl || ""}
                    onChange={(e) => onExternalUrlChange(idx, e.target.value)}
                  />
                  {att.externalUrl && att.externalUrl.startsWith("http") && (
                    <a
                      href={att.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-2 bg-slate-200 text-slate-700 font-bold rounded shrink-0 text-xs"
                    >
                      🔗 開く
                    </a>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={isLocked}
                onClick={() => onRemoveAttachmentRow(idx, att.fileName)}
                className="text-red-500 font-bold ml-auto disabled:opacity-30"
              >
                ✕ 削除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
