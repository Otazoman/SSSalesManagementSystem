"use client";

import { useSetupAdmin } from "../_hooks/useSetupAdmin";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import {
  PublicCard,
  PublicField,
  publicButtonClass,
  publicInputClass,
} from "../../_shared/ui/PublicCard";

export function SetupAdminForm() {
  const {
    isChecking,
    empNum,
    setupToken,
    setSetupToken,
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    success,
    isLoading,
    handleSubmit,
  } = useSetupAdmin();

  // APIチェック中は暗い背景(PublicPage)にインジケータのみを出し、フォームが一瞬でも視界に入る「チラつき」を防ぐ
  if (isChecking) {
    return (
      <div className="text-white text-xs font-semibold tracking-wider animate-pulse">
        システム検証中...
      </div>
    );
  }

  return (
    <PublicCard
      onSubmit={handleSubmit}
      badge={
        <span className="bg-indigo-100 text-indigo-800 text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider">
          System Initialization
        </span>
      }
      title={<span className="block mt-3">初期設定：最初の管理者登録</span>}
      description="データベースが空です。システム全体を統括する最初の「システム管理者」を画面から登録してください。"
    >
      <MessageBanner
        error={error ? `⚠️ ${error}` : undefined}
        message={success ? `🎉 ${success}` : undefined}
      />

      <div className="space-y-4">
        <PublicField label="初期セットアップトークン *">
          <input
            type="password"
            required
            className={publicInputClass}
            placeholder="デプロイ担当者から共有されたトークン"
            value={setupToken}
            onChange={(e) => setSetupToken(e.target.value)}
          />
        </PublicField>

        <PublicField label="従業員番号(システム固定)">
          <div className="w-full border border-slate-200 bg-slate-50 p-2.5 rounded-xl text-base sm:text-xs font-mono font-bold text-slate-700 select-none shadow-inner">
            {empNum}
          </div>
        </PublicField>

        <PublicField label="管理者 氏名 *">
          <input
            type="text"
            required
            className={publicInputClass}
            placeholder="例: システム 管理者"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </PublicField>

        <PublicField label="メールアドレス *">
          <input
            type="email"
            required
            className={publicInputClass}
            placeholder="admin@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </PublicField>

        <PublicField label="初期ログインパスワード *">
          <input
            type="password"
            required
            minLength={6}
            className={publicInputClass}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </PublicField>

        <PublicField label="初期ログインパスワード(確認用) *">
          <input
            type="password"
            required
            minLength={6}
            className={publicInputClass}
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </PublicField>
      </div>

      <button
        type="submit"
        disabled={isLoading || !!success}
        className={publicButtonClass.primary}
      >
        {isLoading ? "登録中..." : "管理者としてシステムを有効化する 🚀"}
      </button>
    </PublicCard>
  );
}
