// app/XXX/page.tsx
"use client";

import { useCompanySettings } from "./_hooks/useCompanySettings";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { BasicSettings } from "./_components/BasicSettings";
import { SmtpSettings } from "./_components/SmtpSettings";
import { NotificationOutboxSettings } from "./_components/NotificationOutboxSettings";
import { SecuritySettings } from "./_components/SecuritySettings";
import { DocumentNumberSettings } from "./_components/DocumentNumberSettings";
import { MasterCodeSettings } from "./_components/MasterCodeSettings";
import { FirmBankingSettings } from "./_components/FirmBankingSettings";

export default function AdminCompanySettingsPage() {
  const {
    settings,
    setSettings,
    loading,
    submitting,
    message,
    error,
    hasMenuAccess,
    canRead,
    canWrite,
    testEmail,
    setTestEmail,
    sendingTest,
    testMessage,
    testError,
    setTestError,
    setTestMessage,
    saveSettings,
    sendTestEmail,
  } = useCompanySettings();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void saveSettings();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-xs text-slate-600 italic animate-pulse">
        🔒 セキュリティ権限の検証中...
      </div>
    );
  }

  if (!hasMenuAccess || !canRead) {
    return (
      <div className="p-6 max-w-2xl bg-white rounded-xl border border-slate-200 shadow-sm mt-4">
        <div className="p-4 bg-red-50 text-red-800 text-xs font-semibold rounded border border-red-100 flex items-center gap-2">
          ⚠️ この画面を閲覧する権限がありません。
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl w-full space-y-6">
      <PageHeader
        title="🏢 会社・システム設定"
        description={
          <>
            Cloudflare
            KVによる高速パラメータ管理、内部統制、およびメール送信基盤を制御します。
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

      {message && (
        <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-semibold rounded border border-emerald-100">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 text-red-800 text-xs font-semibold rounded border border-red-100">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden divide-y divide-slate-100"
      >
        {/* 🏢 会社識別情報セクション */}
        <BasicSettings
          settings={settings}
          setSettings={setSettings}
          canWrite={canWrite}
        />

        {/* ✉️ SMTP設定セクション */}
        <SmtpSettings
          settings={settings}
          setSettings={setSettings}
          canWrite={canWrite}
          testEmail={testEmail}
          setTestEmail={setTestEmail}
          sendingTest={sendingTest}
          testMessage={testMessage}
          testError={testError}
          sendTestEmail={sendTestEmail}
          setTestError={setTestError}
          setTestMessage={setTestMessage}
        />

        {/* 📨 通知送信キュー・Slack連携設定セクション */}
        <NotificationOutboxSettings
          settings={settings}
          setSettings={setSettings}
          canWrite={canWrite}
        />

        {/* 🔒 内部統制・承認機能設定セクション */}
        <SecuritySettings
          settings={settings}
          setSettings={setSettings}
          canWrite={canWrite}
        />

        {/* 🔢 伝票番号フォーマット設定セクション */}
        <DocumentNumberSettings
          settings={settings}
          setSettings={setSettings}
          canWrite={canWrite}
        />

        {/* 🔢 マスタコードフォーマット設定セクション */}
        <MasterCodeSettings
          settings={settings}
          setSettings={setSettings}
          canWrite={canWrite}
        />

        {/* 🏦 ファームバンキング設定セクション */}
        <FirmBankingSettings
          settings={settings}
          setSettings={setSettings}
          canWrite={canWrite}
        />

        {/* 保存ボタン */}
        <div className="p-4 bg-slate-50 flex justify-end">
          <Button type="submit" disabled={submitting || !canWrite}>
            {submitting ? "設定を同期中..." : "マスタ設定を保存する 💾"}
          </Button>
        </div>
      </form>
    </div>
  );
}
