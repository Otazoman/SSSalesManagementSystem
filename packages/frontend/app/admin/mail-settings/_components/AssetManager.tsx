"typescript";
"use client";

import { AssetFileType, UploadStatus } from "../_types";
import { buttonClass } from "../../../_shared/ui/Button";

interface AssetManagerProps {
  canWrite: boolean;
  uploadingType: AssetFileType | null;
  uploadStatuses: { [key in AssetFileType]: UploadStatus | null };
  onFileUpload: (
    e: React.ChangeEvent<HTMLInputElement>,
    fileType: AssetFileType,
  ) => Promise<void>;
}

export function AssetManager({
  canWrite,
  uploadingType,
  uploadStatuses,
  onFileUpload,
}: AssetManagerProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div>
        <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-1">
          <span>⚙️</span> 帳票共通アセットファイル管理 (R2ストレージ連携)
        </h3>
        <p className="text-[11px] text-slate-600 mt-0.5">
          見積書・請求書のPDF生成エンジンが直接参照するシステム共通アセットを管理・アップロードします。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ① 日本語フォントファイル */}
        <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/40 flex flex-col justify-between space-y-2">
          <div className="space-y-0.5">
            <span className="text-[9px] font-mono text-slate-600 block truncate">
              system/fonts/company_fonts.ttf
            </span>
            <h4 className="text-xs font-bold text-slate-800">
              1. 日本語共通フォント (.ttf)
            </h4>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <label
              className={`${buttonClass({ variant: "primary", size: "sm" })} ${(!canWrite || uploadingType !== null) && "opacity-40 pointer-events-none"}`}
            >
              {uploadingType === "font" ? "⌛ 送信中..." : "TTF選択 📤"}
              <input
                type="file"
                accept=".ttf"
                className="hidden"
                disabled={!canWrite || uploadingType !== null}
                onChange={(e) => onFileUpload(e, "font")}
              />
            </label>
            {uploadStatuses.font && (
              <span
                className={`text-[10px] font-bold truncate ${uploadStatuses.font.isError ? "text-rose-600" : "text-emerald-600"}`}
              >
                {uploadStatuses.font.isError ? "❌ エラー" : "✅ 完了"}
              </span>
            )}
          </div>
        </div>

        {/* ② 会社ロゴ画像 */}
        <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/40 flex flex-col justify-between space-y-2">
          <div className="space-y-0.5">
            <span className="text-[9px] font-mono text-slate-600 block truncate">
              system/company/company_logo.png
            </span>
            <h4 className="text-xs font-bold text-slate-800">
              2. 会社ロゴ画像 (.pngのみ)
            </h4>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <label
              className={`${buttonClass({ variant: "primary", size: "sm" })} ${(!canWrite || uploadingType !== null) && "opacity-40 pointer-events-none"}`}
            >
              {uploadingType === "logo" ? "⌛ 送信中..." : "ロゴ選択 📤"}
              <input
                type="file"
                accept="image/png"
                className="hidden"
                disabled={!canWrite || uploadingType !== null}
                onChange={(e) => onFileUpload(e, "logo")}
              />
            </label>
            {uploadStatuses.logo && (
              <span
                className={`text-[10px] font-bold truncate ${uploadStatuses.logo.isError ? "text-rose-600" : "text-emerald-600"}`}
              >
                {uploadStatuses.logo.isError ? "❌ エラー" : "✅ 完了"}
              </span>
            )}
          </div>
        </div>

        {/* ③ ユーザー・会社認印画像 */}
        <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/40 flex flex-col justify-between space-y-2">
          <div className="space-y-0.5">
            <span className="text-[9px] font-mono text-slate-600 block truncate">
              system/company/company_seal.png
            </span>
            <h4 className="text-xs font-bold text-slate-800">
              3. 社印・角印・丸印 (.pngのみ)
            </h4>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <label
              className={`${buttonClass({ variant: "primary", size: "sm" })} ${(!canWrite || uploadingType !== null) && "opacity-40 pointer-events-none"}`}
            >
              {uploadingType === "seal" ? "⌛ 送信中..." : "社印選択 📤"}
              <input
                type="file"
                accept="image/png"
                className="hidden"
                disabled={!canWrite || uploadingType !== null}
                onChange={(e) => onFileUpload(e, "seal")}
              />
            </label>
            {uploadStatuses.seal && (
              <span
                className={`text-[10px] font-bold truncate ${uploadStatuses.seal.isError ? "text-rose-600" : "text-emerald-600"}`}
              >
                {uploadStatuses.seal.isError ? "❌ エラー" : "✅ 完了"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
