import * as v from "valibot";

// ユーザーごとの表示設定(色・ダークモード)。保存先は専用D1(DB_UI。src/db/ui-schema.ts)の user_preferences。
// フロントエンドの色定義(app/theme.css の data-accent)と同じ名前をここで許可する。
export const THEME_MODES = ["system", "light", "dark"] as const;
export const ACCENT_COLORS = ["indigo", "blue", "sky", "emerald", "violet", "rose", "amber", "gray"] as const;

export const UserPreferencesPayloadSchema = v.object({
  themeMode: v.picklist(THEME_MODES, "表示モードが不正です"),
  accentColor: v.picklist(ACCENT_COLORS, "色が不正です"),
});

export type ThemeMode = (typeof THEME_MODES)[number];
export type AccentColor = (typeof ACCENT_COLORS)[number];
export type UserPreferencesPayload = v.InferOutput<typeof UserPreferencesPayloadSchema>;

export const DEFAULT_PREFERENCES: UserPreferencesPayload = { themeMode: "system", accentColor: "indigo" };
