"use client";

import { MailTemplateSetting, UploadStatus } from "../_types";
import { buttonClass } from "../../../_shared/ui/Button";
import { Button } from "../../../_shared/ui/Button";

interface TemplateEditorProps {
  currentTemplate: MailTemplateSetting | undefined;
  canWrite: boolean;
  submitting: boolean;
  onFieldChange: (field: keyof MailTemplateSetting, value: string) => void;
  onSaveSettings: (e: React.SyntheticEvent) => Promise<void>;

  // テスト送信
  testToEmail: string;
  setTestToEmail: (email: string) => void;
  testingEmail: boolean;
  selectedR2Path: string;
  setSelectedR2Path: (path: string) => void;
  onTestSend: (e: React.MouseEvent) => Promise<void>;
  onOpenR2Modal: () => void;

  // 帳票Excelテンプレート
  reportTemplateUploading: boolean;
  reportTemplateStatus: UploadStatus | null;
  onReportTemplateUpload: (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  onReportTemplateDelete: () => Promise<void>;
  onOpenReportTemplateExplorer: () => void;
}

export function TemplateEditor({
  currentTemplate,
  canWrite,
  submitting,
  onFieldChange,
  onSaveSettings,
  testToEmail,
  setTestToEmail,
  testingEmail,
  selectedR2Path,
  setSelectedR2Path,
  onTestSend,
  onOpenR2Modal,
  reportTemplateUploading,
  reportTemplateStatus,
  onReportTemplateUpload,
  onReportTemplateDelete,
  onOpenReportTemplateExplorer,
}: TemplateEditorProps) {
  const inputClass =
    "w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded-lg focus:border-indigo-500 focus:outline-none font-medium transition-colors placeholder:text-slate-500 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed";

  const textareaClass =
    "w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded-lg focus:border-indigo-500 focus:outline-none font-medium transition-colors placeholder:text-slate-500 disabled:bg-slate-50 disabled:text-slate-500 h-48 resize-y";

  if (!currentTemplate) {
    return (
      <div className="text-center p-12 text-xs text-slate-700 bg-white border rounded-xl border-dashed">
        マスタから帳票設定データが検出されませんでした。画面をリロードしてください。
      </div>
    );
  }

  return (
    <form
      onSubmit={onSaveSettings}
      className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden divide-y divide-slate-100"
    >
      <div className="p-6 space-y-5">
        <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider border-b border-slate-100 pb-2">
          【{currentTemplate.name}】 配信固有パラメータ設定
        </h3>

        {/* 帳票Excelテンプレート */}
        <div className="space-y-1.5 bg-slate-50/60 border border-slate-100 rounded-xl p-3">
          <div className="flex justify-between items-center">
            <label className="block text-[11px] font-bold text-slate-600">
              帳票Excelテンプレート (.xlsx)
            </label>
            <div className="flex items-center gap-1.5">
              <label
                className={`${buttonClass({ variant: "primary", size: "sm" })} ${(!canWrite || reportTemplateUploading) && "opacity-40 pointer-events-none"}`}
              >
                {reportTemplateUploading ? "⌛ 送信中..." : "Excel選択 📤"}
                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  disabled={!canWrite || reportTemplateUploading}
                  onChange={onReportTemplateUpload}
                />
              </label>
              <button
                type="button"
                onClick={onOpenReportTemplateExplorer}
                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 font-bold text-[11px] px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              >
                ストレージ内を探す 🗂️
              </button>
            </div>
          </div>

          <div className="p-2 bg-white rounded-lg border border-slate-200 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 truncate">
              <span className="text-slate-700">
                {currentTemplate.reportTemplatePath ? "📎" : "📁"}
              </span>
              <span className="font-mono text-slate-600 truncate">
                {currentTemplate.reportTemplatePath ||
                  "(このマスタにはまだテンプレートが保存されていません。未登録の場合は既定のPDFレイアウトで生成されます)"}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {currentTemplate.reportTemplatePath &&
                currentTemplate.reportLayoutStatus === "PENDING" && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
                    🕐 コンパイル待ち
                  </span>
                )}
              {currentTemplate.reportTemplatePath &&
                currentTemplate.reportLayoutStatus === "READY" && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200">
                    ✅ 適用中
                  </span>
                )}
              {currentTemplate.reportTemplatePath &&
                currentTemplate.reportLayoutStatus === "FAILED" && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-200">
                    ❌ コンパイル失敗
                  </span>
                )}
              {currentTemplate.reportTemplatePath && (
                <button
                  type="button"
                  disabled={!canWrite || reportTemplateUploading}
                  onClick={onReportTemplateDelete}
                  className={`text-rose-500 hover:text-rose-700 text-[10px] font-bold px-1 focus:outline-none cursor-pointer ${(!canWrite || reportTemplateUploading) && "opacity-40 pointer-events-none"}`}
                >
                  削除
                </button>
              )}
            </div>
          </div>

          {currentTemplate.reportLayoutStatus === "FAILED" &&
            currentTemplate.reportLayoutError && (
              <p className="text-[10px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2 leading-relaxed">
                コンパイルエラー: {currentTemplate.reportLayoutError}
              </p>
            )}
          {currentTemplate.reportLayoutStatus === "PENDING" && (
            <p className="text-[10px] text-amber-600 leading-normal">
              ※最大1分程度で自動的にコンパイルされます。しばらくしてから画面をリロードして状態をご確認ください。
            </p>
          )}

          {reportTemplateStatus && (
            <p
              className={`text-[10px] font-bold ${reportTemplateStatus.isError ? "text-rose-600" : "text-emerald-600"}`}
            >
              {reportTemplateStatus.message}
            </p>
          )}
          <p className="text-[10px] text-slate-700 leading-normal">
            ※アップロードすると `report_templates/{currentTemplate.id}.xlsx`
            へ固定パス上書きされます(過去のファイルは残りません)。「ストレージ内を探す」で実際にR2へ保存されたかを確認できます。
          </p>
        </div>

        {/* FROMアドレス */}
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            送信元メールアドレス (FROM)
          </label>
          <input
            type="email"
            disabled={!canWrite}
            placeholder="未設定時は会社共通マスタのSMTP Fromが適用されます"
            className={inputClass}
            value={currentTemplate.smtpFrom || ""}
            onChange={(e) => onFieldChange("smtpFrom", e.target.value)}
          />
        </div>

        {/* CC & BCC */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">
              常時Ccメールアドレス
            </label>
            <input
              type="text"
              disabled={!canWrite}
              placeholder="例) sales-cc@example.com"
              className={inputClass}
              value={currentTemplate.ccAddress || ""}
              onChange={(e) => onFieldChange("ccAddress", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">
              常時Bccメールアドレス
            </label>
            <input
              type="text"
              disabled={!canWrite}
              placeholder="例) audit-archive@example.com"
              className={inputClass}
              value={currentTemplate.bccAddress || ""}
              onChange={(e) => onFieldChange("bccAddress", e.target.value)}
            />
          </div>
        </div>

        {/* 帳票PDFのファイル名プレフィックス */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-700">
            帳票PDFのファイル名プレフィックス(ダウンロード・メール添付時のファイル名)
          </label>
          <input
            type="text"
            disabled={!canWrite}
            maxLength={30}
            placeholder={`空欄なら既定(${currentTemplate.name})`}
            className={inputClass}
            value={currentTemplate.fileNamePrefix ?? currentTemplate.name}
            onChange={(e) => onFieldChange("fileNamePrefix", e.target.value)}
          />
          <p className="text-[11px] text-slate-700">
            「プレフィックス_伝票番号.pdf」の形式になります(例:{" "}
            {currentTemplate.fileNamePrefix || currentTemplate.name}
            _QT-0001.pdf)。 30文字以内。次の文字は使えません: \ / : * ? " &lt;
            &gt; |
          </p>
        </div>

        {/* 件名 */}
        <div className="space-y-1 pt-2">
          <label className="block text-xs font-bold text-slate-700">
            メール送信件名テンプレート *
          </label>
          <input
            type="text"
            required
            disabled={!canWrite}
            placeholder="例) 【御中】見積書のご送付について"
            className={inputClass}
            value={currentTemplate.subjectTemplate || ""}
            onChange={(e) => onFieldChange("subjectTemplate", e.target.value)}
          />
        </div>

        {/* 本文 */}
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            メール本文テンプレート *
          </label>
          <textarea
            required
            disabled={!canWrite}
            placeholder="メールの案内文(定型文)を入力してください"
            className={textareaClass}
            value={currentTemplate.bodyTemplate || ""}
            onChange={(e) => onFieldChange("bodyTemplate", e.target.value)}
          />
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-[10px] text-slate-500 space-y-1">
            <div className="font-bold text-slate-700 flex items-center gap-1">
              <span>💡</span> 差し込み動的プレースホルダー(業務ロジック連端用)
            </div>
            <p className="leading-relaxed">
              本文内に以下のタグを記述すると、実際のメール送信時に自動で変換されます：
              <br />
              <code className="bg-white px-1 py-0.5 border rounded text-indigo-600 font-mono">
                {"{company_name}"}
              </code>{" "}
              取引先企業名 /{" "}
              <code className="bg-white px-1 py-0.5 border rounded text-indigo-600 font-mono">
                {"{doc_id}"}
              </code>{" "}
              伝票番号 /{" "}
              <code className="bg-white px-1 py-0.5 border rounded text-indigo-600 font-mono">
                {"{total_amount}"}
              </code>{" "}
              合計請求金額
            </p>
          </div>
        </div>

        {/* 🧪 送信テスト・シミュレーター */}
        <div className="pt-5 border-t border-dashed border-slate-200 space-y-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs">🧪</span>
            <h4 className="text-xs font-bold text-slate-800">
              【疎通・添付確認】「{currentTemplate.name}
              」のフォーマットで送信テスト
            </h4>
          </div>

          {/* R2ファイルエクスプローラー呼び出しエリア */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="block text-[11px] font-bold text-slate-600">
                テスト用の R2 添付ファイル指定(任意)
              </label>
              <button
                type="button"
                onClick={onOpenR2Modal}
                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 font-bold text-[11px] px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              >
                ストレージ内を探す 🗂️
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="p-2 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-xs w-full">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-slate-600">
                    {selectedR2Path ? "📎" : "📁"}
                  </span>
                  <span className="font-mono text-slate-600 truncate">
                    {selectedR2Path || "(ファイルが選択されていません)"}
                  </span>
                </div>
                {selectedR2Path && (
                  <button
                    type="button"
                    onClick={() => setSelectedR2Path("")}
                    className="text-rose-500 hover:text-rose-700 text-xs font-bold px-1 focus:outline-none cursor-pointer"
                  >
                    解除
                  </button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-slate-600 leading-normal">
              ※「ストレージ内を探す」から、SystemバケットとQuotesバケット(見積)をフォルダ階層でブラウズできます。
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 max-w-xl pt-1">
            <input
              type="email"
              placeholder="テスト受信するあなたのメールアドレス(To)"
              className={inputClass}
              value={testToEmail}
              onChange={(e) => setTestToEmail(e.target.value)}
            />
            <Button
              className="shrink-0"
              disabled={testingEmail || !testToEmail.trim()}
              onClick={onTestSend}
            >
              {testingEmail ? "SMTPリレー配信中..." : "テストメール送信 🚀"}
            </Button>
          </div>
        </div>
      </div>

      {/* 保存ボタン */}
      <div className="p-4 bg-slate-50 flex justify-end">
        <Button type="submit" disabled={submitting || !canWrite}>
          {submitting
            ? "設定をD1へ同期中..."
            : `${currentTemplate.name}設定を保存する 💾`}
        </Button>
      </div>
    </form>
  );
}
