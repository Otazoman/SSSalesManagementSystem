"use client";

import { SystemSettings } from "../_types";

interface SecuritySettingsProps {
  settings: SystemSettings;
  setSettings: React.Dispatch<React.SetStateAction<SystemSettings>>;
  canWrite: boolean;
}

export function SecuritySettings({
  settings,
  setSettings,
  canWrite,
}: SecuritySettingsProps) {
  return (
    <>
      {/* Audit Log */}
      <div className="p-6 space-y-4 bg-slate-50/50">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
          Security統制
        </h3>
        <div className="flex items-start space-x-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <input
            id="audit-toggle"
            type="checkbox"
            disabled={!canWrite}
            className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer mt-0.5"
            checked={settings.is_audit_log_enabled}
            onChange={(e) =>
              setSettings({
                ...settings,
                is_audit_log_enabled: e.target.checked,
              })
            }
          />
          <div className="space-y-1">
            <label
              htmlFor="audit-toggle"
              className="text-xs font-bold text-slate-900 cursor-pointer select-none"
            >
              システム共通操作ログ・証跡の書き込みを有効化する (推奨)
            </label>
          </div>
        </div>

        {/* BUG-022: ログインの失敗回数の上限 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2">
          <label
            htmlFor="login-max-failed-attempts"
            className="block text-xs font-bold text-slate-900"
          >
            ログインの失敗回数の上限(回)
          </label>
          <input
            id="login-max-failed-attempts"
            type="number"
            min={0}
            max={999}
            inputMode="numeric"
            disabled={!canWrite}
            className="w-28 border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 placeholder-slate-500 rounded focus:border-indigo-500 focus:outline-none disabled:opacity-60"
            value={settings.login_max_failed_attempts}
            onChange={(e) =>
              setSettings({
                ...settings,
                login_max_failed_attempts: e.target.value,
              })
            }
          />
          <p className="text-[11px] text-slate-600">
            パスワードをこの回数続けて間違えたアカウントは、ロック(無効化)されます。ロックの解除は「ユーザー管理」で「有効」に戻してください。
            初期のシステム管理者(従業員番号 admin)は無効化せず、15分間ログインを止めます。0 にすると制限しません(既定は 5 回)。
            最後の失敗から24時間たつと、回数は数え直します。
          </p>
        </div>

        {/* BUG-046: パスワードのルール */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="space-y-2">
            <label
              htmlFor="password-min-length"
              className="block text-xs font-bold text-slate-900"
            >
              パスワードの最小文字数(文字)
            </label>
            <input
              id="password-min-length"
              type="number"
              min={8}
              max={64}
              inputMode="numeric"
              disabled={!canWrite}
              className="w-28 border border-slate-300 p-2 text-base sm:text-xs bg-white text-slate-900 placeholder-slate-500 rounded focus:border-indigo-500 focus:outline-none disabled:opacity-60"
              value={settings.password_min_length ?? "8"}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  password_min_length: e.target.value,
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-bold text-slate-900">
              パスワードに必ず含める文字
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { key: "password_require_uppercase", label: "英大文字" },
                  { key: "password_require_lowercase", label: "英小文字" },
                  { key: "password_require_digit", label: "数字" },
                  { key: "password_require_symbol", label: "記号" },
                ] as const
              ).map(({ key, label }) => (
                <label
                  key={key}
                  htmlFor={`${key}-toggle`}
                  className="flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"
                >
                  <input
                    id={`${key}-toggle`}
                    type="checkbox"
                    disabled={!canWrite}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    checked={settings[key] ?? false}
                    onChange={(e) =>
                      setSettings({ ...settings, [key]: e.target.checked })
                    }
                  />
                  <span className="text-xs font-bold text-slate-800">
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-600">
            本人がパスワードを変更・再設定する時に、このルールを満たす必要があります(8〜64文字。既定は8文字以上・文字の種類の指定なし)。
            記号は、英数字以外の半角の文字(! # $ % など)です。
            管理者が「ユーザー管理」でパスワードを入力する場合は、このルールを確かめません。
            パスワードを空欄のままユーザーを登録すると、このルールを満たす初期パスワード(12文字以上)を自動で作ります。
            ルールを変えても、今のパスワードはそのまま使えます(次に変更する時から適用します)。
          </p>
        </div>
      </div>

      {/* ワークフロー・承認統制 (分割アップデート済) */}
      <div className="p-6 space-y-4 bg-slate-50/50">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
          ワークフロー・承認統制
        </h3>

        <div className="space-y-3">
          {/* 1. マスタ単位の承認トグル(Item4-e) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
            <div>
              <p className="text-xs font-bold text-slate-900">
                マスタ種別ごとの「承認フロー機能」を有効化する
              </p>
              <p className="text-[11px] text-slate-600">
                ONにしたマスタ種別のみ、新規登録・変更時に定義された承認申請が必要になります。現時点で実際に機能するのは「取引先」のみです(他のマスタ種別は今後実装予定のため設定を保持するのみ)。
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { key: "is_partner_approval_enabled", label: "取引先" },
                  {
                    key: "is_partner_contact_approval_enabled",
                    label: "取引先担当者",
                  },
                  { key: "is_product_approval_enabled", label: "品目" },
                  {
                    key: "is_product_price_approval_enabled",
                    label: "品目単価",
                  },
                  {
                    key: "is_item_structure_approval_enabled",
                    label: "品目構成",
                  },
                  { key: "is_unit_approval_enabled", label: "単位" },
                  { key: "is_account_approval_enabled", label: "勘定科目" },
                  { key: "is_warehouse_approval_enabled", label: "倉庫" },
                  { key: "is_location_approval_enabled", label: "ロケーション" },
                  {
                    key: "is_business_location_approval_enabled",
                    label: "営業拠点",
                  },
                ] as const
              ).map(({ key, label }) => (
                <label
                  key={key}
                  htmlFor={`${key}-toggle`}
                  className="flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"
                >
                  <input
                    id={`${key}-toggle`}
                    type="checkbox"
                    disabled={!canWrite}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    checked={settings[key]}
                    onChange={(e) =>
                      setSettings({ ...settings, [key]: e.target.checked })
                    }
                  />
                  <span className="text-xs font-bold text-slate-800">
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* 2. 伝票単位の承認トグル(Item4-e) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
            <div>
              <p className="text-xs font-bold text-slate-900">
                伝票種別ごとの「承認フロー機能」を有効化する
              </p>
              <p className="text-[11px] text-slate-600">
                ONにした伝票種別のみ、新規申請・変更・削除時に承認フローが必要になります。現時点で実際に機能するのは「見積」「入庫」「出庫」「棚卸調整」です(それ以外の伝票種別は今後実装予定のため設定を保持するのみ)。
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <h4 className="text-[11px] font-bold text-slate-700">
                  販売関連
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {(
                    [
                      { key: "is_quote_approval_enabled", label: "見積" },
                      { key: "is_sales_order_approval_enabled", label: "受注" },
                      {
                        key: "is_purchase_requisition_approval_enabled",
                        label: "購買申請",
                      },
                      { key: "is_purchase_order_approval_enabled", label: "発注" },
                      { key: "is_sales_approval_enabled", label: "売上" },
                      { key: "is_purchase_approval_enabled", label: "仕入" },
                    ] as const
                  ).map(({ key, label }) => (
                    <label
                      key={key}
                      htmlFor={`${key}-toggle`}
                      className="flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"
                    >
                      <input
                        id={`${key}-toggle`}
                        type="checkbox"
                        disabled={!canWrite}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                        checked={settings[key]}
                        onChange={(e) =>
                          setSettings({ ...settings, [key]: e.target.checked })
                        }
                      />
                      <span className="text-xs font-bold text-slate-800">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-[11px] font-bold text-slate-700">
                  物流関連
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {(
                    [
                      { key: "is_receiving_approval_enabled", label: "入庫" },
                      { key: "is_shipping_approval_enabled", label: "出庫" },
                      { key: "is_inventory_approval_enabled", label: "棚卸調整" },
                      {
                        key: "is_shipping_instruction_approval_enabled",
                        label: "出荷指示(外部倉庫)",
                      },
                      {
                        key: "is_shipping_result_approval_enabled",
                        label: "出荷実績反映(外部倉庫)",
                      },
                      {
                        key: "is_receiving_instruction_approval_enabled",
                        label: "入荷指示(外部倉庫)",
                      },
                      {
                        key: "is_receiving_result_approval_enabled",
                        label: "入荷実績反映(外部倉庫)",
                      },
                      { key: "is_disposal_approval_enabled", label: "廃棄決定" },
                      {
                        key: "is_damage_approval_enabled",
                        label: "品質区分変更(破損)",
                      },
                      { key: "is_return_approval_enabled", label: "返品" },
                    ] as const
                  ).map(({ key, label }) => (
                    <label
                      key={key}
                      htmlFor={`${key}-toggle`}
                      className="flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"
                    >
                      <input
                        id={`${key}-toggle`}
                        type="checkbox"
                        disabled={!canWrite}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                        checked={settings[key]}
                        onChange={(e) =>
                          setSettings({ ...settings, [key]: e.target.checked })
                        }
                      />
                      <span className="text-xs font-bold text-slate-800">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Item8/10: 売上・仕入の計上基準 */}
      <div className="p-6 space-y-4 bg-slate-50/50 border-t border-slate-200">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
          売上・仕入の計上基準
        </h3>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <p className="text-xs font-bold text-slate-900">
            出荷・入荷実績への依存を設定する
          </p>
          <p className="text-[11px] text-slate-600">
            OFF(既定)の場合、受注/発注の明細数量に対して独立して売上・仕入を計上できます。ONにすると、実際に出荷・入荷済みの数量までしか売上・仕入を計上できなくなります。
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(
              [
                {
                  key: "is_sales_invoice_requires_shipment",
                  label: "売上は出荷実績が必要",
                },
                {
                  key: "is_purchase_recognition_requires_receipt",
                  label: "仕入は入荷実績が必要",
                },
              ] as const
            ).map(({ key, label }) => (
              <label
                key={key}
                htmlFor={`${key}-toggle`}
                className="flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"
              >
                <input
                  id={`${key}-toggle`}
                  type="checkbox"
                  disabled={!canWrite}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                  checked={settings[key]}
                  onChange={(e) =>
                    setSettings({ ...settings, [key]: e.target.checked })
                  }
                />
                <span className="text-xs font-bold text-slate-800">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 一覧画面表示設定 */}
      <div className="p-6 space-y-4 bg-slate-50/50">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
          一覧画面表示設定
        </h3>
        <div className="flex items-start space-x-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <input
            id="pagination-toggle"
            type="checkbox"
            disabled={!canWrite}
            className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer mt-0.5"
            checked={settings.is_pagination_enabled}
            onChange={(e) =>
              setSettings({
                ...settings,
                is_pagination_enabled: e.target.checked,
              })
            }
          />
          <div className="space-y-1">
            <label
              htmlFor="pagination-toggle"
              className="text-xs font-bold text-slate-900 cursor-pointer select-none"
            >
              一覧画面のページネーションを有効化する
            </label>
            <p className="text-[11px] text-slate-600">
              ONにすると、各マスタ・一覧画面でページ単位の分割表示に切り替わります。OFFの場合は従来通り全件表示です。
            </p>
          </div>
        </div>

      </div>
    </>
  );
}
