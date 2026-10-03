"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const THEME_MODES = [
  { value: "system", label: "端末の設定に合わせる" },
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
] as const;

/** 色名は backend の ACCENT_COLORS と app/theme.css の html[data-accent] と同じ */
export const ACCENT_COLORS = [
  { value: "indigo", label: "インディゴ", swatch: "#4f46e5" },
  { value: "blue", label: "ブルー", swatch: "#2563eb" },
  { value: "sky", label: "スカイ", swatch: "#0284c7" },
  { value: "emerald", label: "エメラルド", swatch: "#059669" },
  { value: "violet", label: "バイオレット", swatch: "#7c3aed" },
  { value: "rose", label: "ローズ", swatch: "#e11d48" },
  { value: "amber", label: "アンバー", swatch: "#d97706" },
  { value: "gray", label: "グレー", swatch: "#4b5563" },
] as const;

export type ThemeMode = (typeof THEME_MODES)[number]["value"];
export type AccentColor = (typeof ACCENT_COLORS)[number]["value"];
export interface ThemePreferences {
  themeMode: ThemeMode;
  accentColor: AccentColor;
}

export const DEFAULT_THEME: ThemePreferences = {
  themeMode: "system",
  accentColor: "indigo",
};

/** 前回の設定の控え(ログイン前の画面や、読み込み完了前のちらつきを避けるため。正はサーバーの設定) */
const STORAGE_KEY = "ui-theme";

const isMode = (v: unknown): v is ThemeMode =>
  THEME_MODES.some((m) => m.value === v);
const isAccent = (v: unknown): v is AccentColor =>
  ACCENT_COLORS.some((a) => a.value === v);

function readStored(): ThemePreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      themeMode: isMode(raw?.themeMode)
        ? raw.themeMode
        : DEFAULT_THEME.themeMode,
      accentColor: isAccent(raw?.accentColor)
        ? raw.accentColor
        : DEFAULT_THEME.accentColor,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

const prefersDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** <html> に data-theme(light/dark)と data-accent を付ける。色の実体は app/theme.css */
export function applyTheme(prefs: ThemePreferences) {
  const dark =
    prefs.themeMode === "dark" ||
    (prefs.themeMode === "system" && prefersDark());
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.accent = prefs.accentColor;
}

/** 最初の描画より前に色を反映するための小さなスクリプト(layout の <head> に置く) */
export const THEME_INIT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem("${STORAGE_KEY}")||"null")||{};var d=p.themeMode==="dark"||(p.themeMode!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.dataset.accent=p.accentColor||"indigo"}catch(e){}})()`;

interface ThemeValue {
  preferences: ThemePreferences;
  /** 設定を保存する(サーバーに保存できたら画面にも反映)。失敗したら例外を投げる */
  save: (next: ThemePreferences) => Promise<void>;
}

const ThemeContext = createContext<ThemeValue>({
  preferences: DEFAULT_THEME,
  save: async () => {},
});

/**
 * ユーザーごとの表示設定(ダークモード・基調色)を、ログイン後に読み込んで画面に反映する。
 * 設定は専用D1(user_preferences)にユーザーごとに保存される。
 */
export function ThemeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  // 前回の控えから始める(このstateは画面の描画には使わず、<html>への反映と設定画面の初期値に使う)
  const [preferences, setPreferences] = useState<ThemePreferences>(() =>
    typeof window === "undefined" ? DEFAULT_THEME : readStored(),
  );

  // ログイン後: サーバーの設定に置き換える。取得に失敗した場合は控えのまま動作を続ける
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/user-preferences", {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!isMode(data?.themeMode) || !isAccent(data?.accentColor)) return;
        const next = {
          themeMode: data.themeMode,
          accentColor: data.accentColor,
        };
        setPreferences(next);
      } catch {
        // 既定/前回の色のまま続ける
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // 設定が変わったら反映し、控えも更新。「端末の設定に合わせる」時は端末側の切り替えにも追従する
  useEffect(() => {
    applyTheme(preferences);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // 控えが保存できなくても動作には影響しない
    }
    if (preferences.themeMode !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(preferences);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preferences]);

  const save = useCallback(async (next: ThemePreferences) => {
    const res = await fetch("/api/user-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "表示設定の保存に失敗しました");
    }
    setPreferences(next);
  }, []);

  const value = useMemo(() => ({ preferences, save }), [preferences, save]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
