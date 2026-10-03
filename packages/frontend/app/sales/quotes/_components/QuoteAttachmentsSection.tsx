import React from "react";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { Button } from "../../../_shared/ui/Button";
import { QuoteAttachment } from "../_types";

interface QuoteAttachmentsSectionProps {
  quoteId: string;
  attachments: QuoteAttachment[];
  onAddAttachmentRow: (storageType: "R2" | "GOOGLE_DRIVE") => void;
  onRemoveAttachmentRow: (index: number, fileName: string) => void;
  onFileSelection: (
    index: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => void;
  onFileNameChange: (index: number, value: string) => void;
  onExternalUrlChange: (index: number, value: string) => void;
}

const inputClass = formFieldInputClass;

export function QuoteAttachmentsSection({
  quoteId,
  attachments,
  onAddAttachmentRow,
  onRemoveAttachmentRow,
  onFileSelection,
  onFileNameChange,
  onExternalUrlChange,
}: QuoteAttachmentsSectionProps) {
  return (
    <div className="space-y-3 pt-2 border-t border-slate-100">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <label className="text-xs font-bold text-slate-700 block">
            📎 証跡・添付ファイルの管理
          </label>
          <span className="text-[10px] text-slate-600 block">
            R2へのバイナリ保存、または外部リンク指定
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAddAttachmentRow("R2")}
          >
            📂 ファイルを選択
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAddAttachmentRow("GOOGLE_DRIVE")}
          >
            🔗 共有リンク貼付
          </Button>
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
                        href={`/api/quotes/download/${quoteId}/${att.id}`}
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
                onClick={() => onRemoveAttachmentRow(idx, att.fileName)}
                className="text-red-700 font-bold ml-auto py-2 sm:py-0"
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
