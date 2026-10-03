"use client";

import { SystemSettings } from "../_types";
import {
  DEFAULT_TAX_ROUNDING_MODE,
  TAX_ROUNDING_MODE_OPTIONS,
  toTaxRoundingMode,
} from "../../../_shared/tax-amounts";

interface BasicSettingsProps {
  settings: SystemSettings;
  setSettings: React.Dispatch<React.SetStateAction<SystemSettings>>;
  canWrite: boolean;
}

const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 rounded-lg focus:border-indigo-500 focus:outline-none font-medium transition-colors placeholder:text-slate-500 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed";

export function BasicSettings({
  settings,
  setSettings,
  canWrite,
}: BasicSettingsProps) {
  return (
    <div className="p-6 space-y-5">
      <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider border-b border-slate-100 pb-2">
        企業識別情報・基本環境パラメータ
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">
            公式会社名称 *
          </label>
          <input
            type="text"
            required
            disabled={!canWrite}
            className={inputClass}
            value={settings.company_name}
            onChange={(e) =>
              setSettings({ ...settings, company_name: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-700">
            システム本番環境URL (サイトURL)
          </label>
          <input
            type="url"
            disabled={!canWrite}
            placeholder="https://sms.example.com"
            className={inputClass}
            value={settings.site_url}
            onChange={(e) =>
              setSettings({ ...settings, site_url: e.target.value })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        {/* 👈 郵便番号の追加 */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-700">
            郵便番号
          </label>
          <input
            type="text"
            disabled={!canWrite}
            placeholder="例) 100-0005"
            className={inputClass}
            value={settings.company_zip || ""}
            onChange={(e) =>
              setSettings({ ...settings, company_zip: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-700">
            会社所在地 (住所)
          </label>
          <input
            type="text"
            disabled={!canWrite}
            placeholder="例) 東京都千代田区丸の内1-1-1"
            className={inputClass}
            value={settings.company_address}
            onChange={(e) =>
              setSettings({ ...settings, company_address: e.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-700">
            代表電話番号
          </label>
          <input
            type="text"
            disabled={!canWrite}
            placeholder="例) 03-XXXX-XXXX"
            className={inputClass}
            value={settings.company_tel}
            onChange={(e) =>
              setSettings({ ...settings, company_tel: e.target.value })
            }
          />
        </div>
        {/* 👈 FAX番号の追加 */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-700">
            FAX番号
          </label>
          <input
            type="text"
            disabled={!canWrite}
            placeholder="例) 03-XXXX-YYYY"
            className={inputClass}
            value={settings.company_fax || ""}
            onChange={(e) =>
              setSettings({ ...settings, company_fax: e.target.value })
            }
          />
        </div>
        {/* Item4-a: 帳票テンプレートの{{company_invoice_no}}に対応 */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-700">
            登録番号 (インボイス制度)
          </label>
          <input
            type="text"
            disabled={!canWrite}
            placeholder="例) T1234567890123"
            className={inputClass}
            value={settings.company_invoice_registration_no || ""}
            onChange={(e) =>
              setSettings({
                ...settings,
                company_invoice_registration_no: e.target.value,
              })
            }
          />
        </div>
        {/* BUG-042: 消費税の端数処理。伝票(請求書)ごと・税率ごとに1回、この方法で計算する */}
        <div className="space-y-1">
          <label htmlFor="tax-rounding-mode" className="block text-xs font-semibold text-slate-700">
            消費税の端数処理
          </label>
          <select
            id="tax-rounding-mode"
            disabled={!canWrite}
            className={inputClass}
            value={settings.tax_rounding_mode || DEFAULT_TAX_ROUNDING_MODE}
            onChange={(e) =>
              setSettings({ ...settings, tax_rounding_mode: toTaxRoundingMode(e.target.value) })
            }
          >
            {TAX_ROUNDING_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-600">
            見積・受注・売上・仕入・発注・購買申請・請求書の消費税は、伝票ごとに税率ごとの合計へ1回だけ、この方法で端数処理します。
            変更後に保存した伝票から適用されます(保存済みの伝票の消費税は変わりません)。
          </p>
        </div>
      </div>
    </div>
  );
}
