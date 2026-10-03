"use client";

import { SystemSettings } from "../_types";
import { Button } from "../../../_shared/ui/Button";

interface SmtpSettingsProps {
  settings: SystemSettings;
  setSettings: React.Dispatch<React.SetStateAction<SystemSettings>>;
  canWrite: boolean;
  testEmail: string;
  setTestEmail: (email: string) => void;
  sendingTest: boolean;
  testMessage: string;
  testError: string;
  sendTestEmail: () => Promise<void>;
  setTestError: (msg: string) => void;
  setTestMessage: (msg: string) => void;
}

export function SmtpSettings({
  settings,
  setSettings,
  canWrite,
  testEmail,
  setTestEmail,
  sendingTest,
  testMessage,
  testError,
  sendTestEmail,
  setTestError,
  setTestMessage,
}: SmtpSettingsProps) {
  const handleTestSubmit = (e: React.MouseEvent) => {
    e.preventDefault();
    void sendTestEmail();
  };

  return (
    <div className="p-6 space-y-4 bg-slate-50/20">
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
        ✉️ システム通知用 SMTPメールサーバ設定
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            SMTPホスト名
          </label>
          <input
            type="text"
            disabled={!canWrite}
            placeholder="smtp.gmail.com"
            className="w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
            value={settings.smtp_host}
            onChange={(e) =>
              setSettings({ ...settings, smtp_host: e.target.value })
            }
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Port番号
          </label>
          <input
            type="text"
            disabled={!canWrite}
            placeholder="587"
            className="w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
            value={settings.smtp_port}
            onChange={(e) =>
              setSettings({ ...settings, smtp_port: e.target.value })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            SMTP認証ユーザー名 (Gmailアドレス)
          </label>
          <input
            type="text"
            disabled={!canWrite}
            placeholder="your-name@gmail.com"
            className="w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
            value={settings.smtp_user}
            onChange={(e) =>
              setSettings({ ...settings, smtp_user: e.target.value })
            }
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            SMTPパスワード (Gmail 16桁アプリパスワード)
          </label>
          <input
            type="password"
            disabled={!canWrite}
            placeholder={
              settings.smtp_pass_configured
                ? "設定済み(変更する時だけ入力)"
                : "xxxx xxxx xxxx xxxx"
            }
            className="w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 placeholder-slate-500 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
            value={settings.smtp_pass}
            onChange={(e) =>
              setSettings({ ...settings, smtp_pass: e.target.value })
            }
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          システム送信元メールアドレス (From)
        </label>
        <input
          type="email"
          disabled={!canWrite}
          placeholder="noreply@example.com"
          className="w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
          value={settings.smtp_from}
          onChange={(e) =>
            setSettings({ ...settings, smtp_from: e.target.value })
          }
        />
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200/60">
        <label className="block text-xs font-bold text-slate-600 mb-1">
          🚀 接続テストメールの送信
        </label>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="テスト受信先アドレス"
            className="flex-1 border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
          />
          <Button
            onClick={handleTestSubmit}
            disabled={sendingTest || !testEmail}
          >
            {sendingTest ? "送信中..." : "テスト送信"}
          </Button>
        </div>
        {testMessage && (
          <p className="text-[11px] text-emerald-600 mt-2 font-semibold">
            {testMessage}
          </p>
        )}
        {testError && (
          <p className="text-[11px] text-red-600 mt-2 font-semibold">
            {testError}
          </p>
        )}
      </div>
    </div>
  );
}
