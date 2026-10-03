"use client";

import { Suspense, type ReactNode } from "react";

interface PublicPageProps {
  /** dark: 初期設定画面のように背景を暗くする */
  tone?: "light" | "dark";
  /** URLのクエリ(useSearchParams)を読む子のための読み込み中表示 */
  fallback?: string;
  className?: string;
  children: ReactNode;
}

/**
 * ログイン前に開く画面(認証系・OTPダウンロード等)の全画面ラッパー。中身を画面中央に置き、
 * 内容が画面より高い(スマホ・キーボード表示時など)場合は縦スクロールできる。
 * useSearchParams を使う子のため Suspense も内包する。
 */
export function PublicPage({
  tone = "light",
  fallback = "読み込み中...",
  className = "",
  children,
}: PublicPageProps) {
  const bg = tone === "dark" ? "bg-slate-900" : "bg-slate-100";
  const fallbackColor = tone === "dark" ? "text-white" : "text-slate-600";
  return (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto p-4 ${bg} ${className}`.trim()}
    >
      <div className="flex min-h-full items-center justify-center">
        <Suspense
          fallback={
            <div className={`text-xs font-bold animate-pulse ${fallbackColor}`}>
              {fallback}
            </div>
          }
        >
          {children}
        </Suspense>
      </div>
    </div>
  );
}
