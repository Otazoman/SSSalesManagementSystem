import { useState } from "react";
import { Button } from "../../_shared/ui/Button";
import {
  ACCENT_COLORS,
  THEME_MODES,
  useTheme,
  type AccentColor,
  type ThemeMode,
} from "../../context/theme";

/** 画面の色(ダークモード・基調色)。ユーザーごとに保存され、次回ログイン時も引き継がれる */
export function DisplaySettingsForm() {
  const { preferences, save } = useTheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>(preferences.themeMode);
  const [accentColor, setAccentColor] = useState<AccentColor>(
    preferences.accentColor,
  );
  // サーバーの設定の読み込みがフォームの表示より後になっても、選択状態を合わせる
  const [syncedFrom, setSyncedFrom] = useState(preferences);
  if (syncedFrom !== preferences) {
    setSyncedFrom(preferences);
    setThemeMode(preferences.themeMode);
    setAccentColor(preferences.accentColor);
  }
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await save({ themeMode, accentColor });
      setMessage("表示設定を保存しました");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "予期せぬエラーが発生しました",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-6 rounded-xl border border-slate-200 space-y-4 shadow-sm"
    >
      <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-1">
        表示設定
      </h3>
      {message && (
        <div className="p-3 bg-green-50 text-green-700 text-xs rounded font-medium border border-green-100">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 text-xs rounded font-medium border border-red-100">
          {error}
        </div>
      )}

      <fieldset>
        <legend className="block text-xs font-semibold text-slate-800 mb-1">
          表示モード
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {THEME_MODES.map((m) => (
            <label
              key={m.value}
              className="flex items-center gap-1.5 text-sm text-slate-700"
            >
              <input
                type="radio"
                name="themeMode"
                value={m.value}
                checked={themeMode === m.value}
                onChange={() => setThemeMode(m.value)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="block text-xs font-semibold text-slate-800 mb-1">
          基調色(ボタンやリンクの色)
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ACCENT_COLORS.map((a) => (
            <label
              key={a.value}
              className="flex items-center gap-1.5 text-sm text-slate-700"
            >
              <input
                type="radio"
                name="accentColor"
                value={a.value}
                checked={accentColor === a.value}
                onChange={() => setAccentColor(a.value)}
              />
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 rounded-full border border-slate-300"
                style={{ backgroundColor: a.swatch }}
              />
              {a.label}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-[11px] text-slate-600">
        この設定はあなたのアカウントに保存され、別の端末でも同じ表示になります。
      </p>

      <Button className="w-full" type="submit" disabled={isSubmitting}>
        表示設定を保存する
      </Button>
    </form>
  );
}
