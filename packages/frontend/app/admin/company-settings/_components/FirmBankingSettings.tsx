"use client";

import { SystemSettings } from "../_types";

interface FirmBankingSettingsProps {
  settings: SystemSettings;
  setSettings: React.Dispatch<React.SetStateAction<SystemSettings>>;
  canWrite: boolean;
}

const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded-lg focus:border-indigo-500 focus:outline-none font-medium transition-colors placeholder:text-slate-500 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed";

// ファームバンキング: 支払管理画面から全銀「総合振込」フォーマットの振込データを作成する際、
// ヘッダーレコードに埋め込む自社(委託者)口座情報。半角(数字・半角カナ)での入力が必須
// (ファイル生成時にJIS X0201へそのままエンコードするため、全角文字が混じると生成時に警告が出る)
export function FirmBankingSettings({
  settings,
  setSettings,
  canWrite,
}: FirmBankingSettingsProps) {
  return (
    <div className="p-6 space-y-4 bg-slate-50/50">
      <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
        ファームバンキング(全銀総合振込フォーマット)
      </h3>
      <p className="text-[11px] text-slate-500">
        支払管理画面から振込データファイルを作成する際に使う自社口座情報です。銀行名・支店名・委託者名は半角カナで入力してください。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            委託者コード*
          </label>
          <input
            type="text"
            disabled={!canWrite}
            className={inputClass}
            placeholder="10桁以内の数字"
            value={settings.fb_committer_code}
            onChange={(e) =>
              setSettings({ ...settings, fb_committer_code: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            委託者名(半角カナ)
          </label>
          <input
            type="text"
            disabled={!canWrite}
            className={inputClass}
            placeholder="ｶﾌﾞｼｷｶﾞｲｼｬｻﾝﾌﾟﾙ"
            value={settings.fb_committer_name}
            onChange={(e) =>
              setSettings({ ...settings, fb_committer_name: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            仕向銀行番号*
          </label>
          <input
            type="text"
            disabled={!canWrite}
            className={inputClass}
            placeholder="4桁"
            value={settings.fb_bank_code}
            onChange={(e) =>
              setSettings({ ...settings, fb_bank_code: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            仕向銀行名(半角カナ)
          </label>
          <input
            type="text"
            disabled={!canWrite}
            className={inputClass}
            value={settings.fb_bank_name}
            onChange={(e) =>
              setSettings({ ...settings, fb_bank_name: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            仕向支店番号*
          </label>
          <input
            type="text"
            disabled={!canWrite}
            className={inputClass}
            placeholder="3桁"
            value={settings.fb_branch_code}
            onChange={(e) =>
              setSettings({ ...settings, fb_branch_code: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            仕向支店名(半角カナ)
          </label>
          <input
            type="text"
            disabled={!canWrite}
            className={inputClass}
            value={settings.fb_branch_name}
            onChange={(e) =>
              setSettings({ ...settings, fb_branch_name: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            預金種目
          </label>
          <select
            disabled={!canWrite}
            className={inputClass}
            value={settings.fb_account_type}
            onChange={(e) =>
              setSettings({
                ...settings,
                fb_account_type: e.target.value as "ORDINARY" | "CURRENT",
              })
            }
          >
            <option value="ORDINARY">普通</option>
            <option value="CURRENT">当座</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            自社口座番号*
          </label>
          <input
            type="text"
            disabled={!canWrite}
            className={inputClass}
            placeholder="7桁以内"
            value={settings.fb_account_number}
            onChange={(e) =>
              setSettings({ ...settings, fb_account_number: e.target.value })
            }
          />
        </div>
      </div>
    </div>
  );
}
