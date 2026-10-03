// app/PermissionGuard.tsx
"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { UserState, MenuItem } from "./types";
import { AccessDenied } from "./AccessDenied"; // 同一階層からインポート

interface PermissionGuardProps {
  user: UserState | null;
  flatScreens: MenuItem[];
  loading: boolean;
  isAuthPage: boolean;
  children: React.ReactNode;
}

export function PermissionGuard({
  user,
  flatScreens,
  loading,
  isAuthPage,
  children,
}: PermissionGuardProps) {
  const pathname = usePathname();

  // 1. 認証必須ではないページ、ダッシュボード、プロフィールは無条件で通す
  if (isAuthPage || pathname === "/dashboard" || pathname === "/profile") {
    return <>{children}</>;
  }

  // 2. ユーザー情報がない場合は何も表示しない（またはローディング等）
  if (!user) return null;

  // 3. システム管理者（ADMIN）はすべての画面にアクセス可能
  if (user.roleId === "admin") return <>{children}</>;

  // 💡 パス末尾のスラッシュや拡張子の差分を吸収して比較するロジック
  const cleanPathname = pathname
    .replace(/\.[^/.]+$/, "")
    .replace(/\/$/, "")
    .toLowerCase();

  const matchedScreen = flatScreens.find((s) => {
    const cleanTarget = s.path
      .replace(/\.[^/.]+$/, "")
      .replace(/\/$/, "")
      .toLowerCase();
    return (
      cleanTarget === cleanPathname ||
      cleanPathname.startsWith(cleanTarget + "/")
    );
  });

  // 画面マスタが読み込み中のときは一旦ガードする
  if (flatScreens.length === 0 && loading) return null;

  // 該当する画面がない、または権限がない場合は「アクセス制限エラー」を表示
  if (
    !matchedScreen ||
    !user.permissions.includes(`${matchedScreen.resource}:menu`)
  ) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}
