"use client";

import { useMailSettings } from "./_hooks/useMailSettings";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { AssetManager } from "./_components/AssetManager";
import { TemplateSelector } from "./_components/TemplateSelector";
import { TemplateEditor } from "./_components/TemplateEditor";
import { OtpDownloadSettings } from "./_components/OtpDownloadSettings";
import { R2ExplorerModal } from "./_components/R2ExplorerModal";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";

export default function AdminMailSettingsPage() {
  const {
    templates,
    activeTab,
    setActiveTab,
    loading,
    submitting,
    message,
    setMessage,
    error,
    setError,
    otpSettings,
    otpSettingsLoading,
    otpSettingsSubmitting,
    handleOtpFieldChange,
    handleSaveOtpSettings,
    testToEmail,
    setTestToEmail,
    testingEmail,
    selectedR2Path,
    setSelectedR2Path,
    isR2ModalOpen,
    setIsR2ModalOpen,
    r2ModalInitialPrefix,
    hasMenuAccess,
    canRead,
    canWrite,
    uploadingType,
    uploadStatuses,
    currentTemplate,
    handleFieldChange,
    handleSaveSettings,
    handleTestSend,
    handleFileUpload,
    reportTemplateUploading,
    reportTemplateStatus,
    setReportTemplateStatus,
    handleReportTemplateUpload,
    handleReportTemplateDelete,
    openR2ModalForAttachment,
    openR2ModalForReportTemplates,
  } = useMailSettings();

  // 1. ローディング状態のハンドリング
  if (loading) {
    return <LoadingGate label="🔒 セキュリティ権限の検証中..." />;
  }

  // 2. セキュリティ権限のガード
  if (!hasMenuAccess || !canRead) {
    return (
      <AccessDeniedInline
        title="⚠️ この画面を閲覧する権限がありません"
        description=""
      />
    );
  }

  return (
    <div className="max-w-6xl w-full space-y-6">
      {/* タイトルヘッダー */}
      <PageHeader
        title="✉️ メール送信設定"
        description={
          <>
            各種業務帳票を外部にメール送信する際の、共通テンプレートとルーティング(FROM
            / CC / BCC)を一元管理します。
          </>
        }
        actions={
          <>
            {!canWrite && (
              <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-1 rounded border border-slate-200 shadow-2xs">
                👁️ 閲覧専用モード
              </span>
            )}
          </>
        }
      />

      {/* メッセージ通知 */}
      {message && (
        <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-semibold rounded border border-emerald-100 flex items-center justify-between">
          <span>{message}</span>
          <button
            onClick={() => setMessage("")}
            className="text-emerald-400 hover:text-emerald-600 focus:outline-none"
          >
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 text-red-800 text-xs font-semibold rounded border border-red-100 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            className="text-red-400 hover:text-red-600 focus:outline-none"
          >
            ✕
          </button>
        </div>
      )}

      {/* 帳票共通アセットファイル管理エリア */}
      <AssetManager
        canWrite={canWrite}
        uploadingType={uploadingType}
        uploadStatuses={uploadStatuses}
        onFileUpload={handleFileUpload}
      />

      {/* 下段：2カラムレイアウト(テンプレート選択 & エディタ) */}
      <div className="flex flex-col md:flex-row gap-6">
        <TemplateSelector
          templates={templates}
          activeTab={activeTab}
          onSelectTab={(id) => {
            setActiveTab(id);
            setMessage("");
            setError("");
            setReportTemplateStatus(null);
          }}
        />

        <div className="flex-1">
          <TemplateEditor
            currentTemplate={currentTemplate}
            canWrite={canWrite}
            submitting={submitting}
            onFieldChange={handleFieldChange}
            onSaveSettings={handleSaveSettings}
            testToEmail={testToEmail}
            setTestToEmail={setTestToEmail}
            testingEmail={testingEmail}
            selectedR2Path={selectedR2Path}
            setSelectedR2Path={setSelectedR2Path}
            onTestSend={handleTestSend}
            onOpenR2Modal={openR2ModalForAttachment}
            reportTemplateUploading={reportTemplateUploading}
            reportTemplateStatus={reportTemplateStatus}
            onReportTemplateUpload={handleReportTemplateUpload}
            onReportTemplateDelete={handleReportTemplateDelete}
            onOpenReportTemplateExplorer={openR2ModalForReportTemplates}
          />
        </div>
      </div>

      {/* OTPダウンロードの詳細設定(会社・システム設定から移設) */}
      <OtpDownloadSettings
        settings={otpSettings}
        loading={otpSettingsLoading}
        submitting={otpSettingsSubmitting}
        canWrite={canWrite}
        onFieldChange={handleOtpFieldChange}
        onSave={handleSaveOtpSettings}
      />

      {/* R2マルチバケットエクスプローラー(モーダル) */}
      {isR2ModalOpen && (
        <R2ExplorerModal
          onClose={() => setIsR2ModalOpen(false)}
          selectedR2Path={selectedR2Path}
          onSelectPath={setSelectedR2Path}
          initialPrefix={r2ModalInitialPrefix}
        />
      )}
    </div>
  );
}
