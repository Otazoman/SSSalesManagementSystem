"use client";

import { SystemSettings, MASTER_TYPES, DocumentNumberFormat } from "../_types";

interface MasterCodeSettingsProps {
  settings: SystemSettings;
  setSettings: React.Dispatch<React.SetStateAction<SystemSettings>>;
  canWrite: boolean;
}

const DEFAULT_DIGIT_COUNT = 4;

// DocumentNumberSettings.tsxと同じ方針。マスタ種別ごとの番号フォーマット(プレフィックス有無・桁数)を
// 設定する。未設定の種別はバックエンド側のデフォルト(種別ごとの既定プレフィックス+4桁)がそのまま使われる
export function MasterCodeSettings({ settings, setSettings, canWrite }: MasterCodeSettingsProps) {
  const formats = settings.master_code_formats || {};

  const getFormat = (key: string, defaultPrefix: string): DocumentNumberFormat =>
    formats[key] || { usePrefix: true, prefix: defaultPrefix, digitCount: DEFAULT_DIGIT_COUNT };

  const updateFormat = (key: string, defaultPrefix: string, patch: Partial<DocumentNumberFormat>) => {
    const current = getFormat(key, defaultPrefix);
    setSettings({
      ...settings,
      master_code_formats: {
        ...formats,
        [key]: { ...current, ...patch },
      },
    });
  };

  return (
    <div className="p-6 space-y-4 bg-slate-50/50">
      <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">マスタコードフォーマット</h3>
      <p className="text-[11px] text-slate-500">
        マスタ種別ごとに、コードのプレフィックス有無・桁数(乱数部分)を設定します。登録画面でコードを空欄のまま保存すると自動採番されます(手入力したコードはそのまま使われます)。既存レコードのコードは変わりません。
      </p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-slate-600 font-bold">
            <tr>
              <th className="px-3 py-2 text-left">マスタ種別</th>
              <th className="px-3 py-2 text-center w-24">プレフィックス</th>
              <th className="px-3 py-2 text-left w-32">プレフィックス文字列</th>
              <th className="px-3 py-2 text-left w-28">桁数</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {MASTER_TYPES.map(({ key, label, defaultPrefix }) => {
              const format = getFormat(key, defaultPrefix);
              return (
                <tr key={key}>
                  <td className="px-3 py-2 font-semibold text-slate-800">{label}</td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      disabled={!canWrite}
                      checked={format.usePrefix}
                      onChange={(e) => updateFormat(key, defaultPrefix, { usePrefix: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      disabled={!canWrite || !format.usePrefix}
                      value={format.prefix}
                      onChange={(e) => updateFormat(key, defaultPrefix, { prefix: e.target.value })}
                      className="w-full border border-slate-300 rounded px-2 py-1 bg-slate-50 text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      max={10}
                      disabled={!canWrite}
                      value={format.digitCount}
                      onChange={(e) =>
                        updateFormat(key, defaultPrefix, { digitCount: Number(e.target.value) || 1 })
                      }
                      className="w-full border border-slate-300 rounded px-2 py-1 bg-slate-50 text-slate-900 font-bold disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
