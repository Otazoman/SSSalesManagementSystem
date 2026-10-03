"use client";

import { SystemSettings } from "../../company-settings/_types";

interface OtpDownloadSettingsProps {
  settings: SystemSettings | null;
  loading: boolean;
  submitting: boolean;
  canWrite: boolean;
  onFieldChange: <K extends keyof SystemSettings>(
    field: K,
    value: SystemSettings[K],
  ) => void;
  onSave: (e: React.SyntheticEvent) => void;
}

export function OtpDownloadSettings({
  settings,
  loading,
  submitting,
  canWrite,
  onFieldChange,
  onSave,
}: OtpDownloadSettingsProps) {
  if (loading || !settings) {
    return (
      <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
        <p className="text-xs text-slate-600 italic">読み込み中...</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSave}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm"
    >
      <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
        🔐 OTPダウンロードの詳細設定(全帳票共通)
      </h3>

      <fieldset disabled={!canWrite || submitting} className="space-y-3">
        <div className="flex items-start space-x-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
          <input
            id="otp-download-restriction-toggle"
            type="checkbox"
            className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer mt-0.5"
            checked={settings.is_otp_download_restricted_to_contacts}
            onChange={(e) =>
              onFieldChange(
                "is_otp_download_restricted_to_contacts",
                e.target.checked,
              )
            }
          />
          <div className="space-y-1">
            <label
              htmlFor="otp-download-restriction-toggle"
              className="text-xs font-bold text-slate-900 cursor-pointer select-none"
            >
              OTPダウンロードの宛先を取引先の登録済み連絡先に限定する
            </label>
            <p className="text-[11px] text-slate-500">
              ONの場合、ダウンロードリンクを開いた際に入力されたメールアドレスが当該取引先の登録済み連絡先(メール受信対象)と一致しない場合はOTPを送信しません。OFFの場合は入力された任意のアドレスにOTPを送信します。この設定は、受信者がメールアドレスを入力する帳票(見積書・注文請書・売上関連書類・請求書・発注書・検収書)に適用されます。納品書・出荷指示書・入荷指示書は、登録済みの連絡先へOTPを自動送信するため入力のステップが無く、この設定の影響を受けません。
            </p>
          </div>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
          <p className="text-xs font-bold text-slate-900">
            OTPダウンロードのコード仕様(全帳票共通)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                桁数
              </label>
              <input
                type="text"
                placeholder="4"
                className="w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
                value={settings.otp_digit_count}
                onChange={(e) =>
                  onFieldChange("otp_digit_count", e.target.value)
                }
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                有効期限(分)
              </label>
              <input
                type="text"
                placeholder="10"
                className="w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
                value={settings.otp_expiry_minutes}
                onChange={(e) =>
                  onFieldChange("otp_expiry_minutes", e.target.value)
                }
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                最大試行回数
              </label>
              <input
                type="text"
                placeholder="5"
                className="w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
                value={settings.otp_max_attempts}
                onChange={(e) =>
                  onFieldChange("otp_max_attempts", e.target.value)
                }
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-600">
            OTPダウンロードに対応するすべての帳票(見積書・注文請書・納品書・売上関連書類・請求書・発注書・検収書・出荷指示書・入荷指示書)で、確認コードの桁数・有効期限・入力ミスの許容回数を共通で設定します。ダウンロードの発行・確認履歴は「OTPダウンロードログ」画面で確認できます。
          </p>
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={!canWrite || submitting}
        className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
          canWrite && !submitting
            ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            : "bg-slate-300 text-slate-500 cursor-not-allowed"
        }`}
      >
        {submitting ? "処理中..." : "OTPダウンロード設定を保存"}
      </button>
    </form>
  );
}
