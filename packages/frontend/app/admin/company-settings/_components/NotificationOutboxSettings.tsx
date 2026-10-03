"use client";

import { SystemSettings } from "../_types";

interface NotificationOutboxSettingsProps {
  settings: SystemSettings;
  setSettings: React.Dispatch<React.SetStateAction<SystemSettings>>;
  canWrite: boolean;
}

export function NotificationOutboxSettings({
  settings,
  setSettings,
  canWrite,
}: NotificationOutboxSettingsProps) {
  return (
    <div className="p-6 space-y-4 bg-slate-50/20">
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
        📨 通知送信キュー・Slack連携設定
      </h3>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Slack Bot Token
        </label>
        <input
          type="password"
          disabled={!canWrite}
          placeholder={
            settings.slack_bot_token_configured
              ? "設定済み(変更する時だけ入力)"
              : "xoxb-..."
          }
          className="w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 placeholder-slate-500 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
          value={settings.slack_bot_token}
          onChange={(e) =>
            setSettings({ ...settings, slack_bot_token: e.target.value })
          }
        />
        <p className="text-[11px] text-slate-600 mt-1">
          承認ワークフロー通知をSlack
          DMで受け取りたいユーザーがいる場合に設定します(プロフィール画面で個人ごとに通知方法を選択)。
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Cronバッチサイズ(1回の実行で処理する件数)
        </label>
        <input
          type="text"
          disabled={!canWrite}
          placeholder="5"
          className="w-32 border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
          value={settings.mail_batch_size}
          onChange={(e) =>
            setSettings({ ...settings, mail_batch_size: e.target.value })
          }
        />
        <p className="text-[11px] text-slate-600 mt-1">
          無料プランのCron実行はCPU時間が短いため、送信滞留が発生する場合を除き既定値(5件)のままを推奨します。
        </p>
      </div>
    </div>
  );
}
