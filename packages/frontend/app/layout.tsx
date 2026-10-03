// app/layout.tsx
"use client";

import React, { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import "./globals.css";
import { PermissionProvider } from "./context/permissioncontext";
import { ScreenDescriptionProvider } from "./context/screen-descriptions";
import { ThemeProvider, THEME_INIT_SCRIPT } from "./context/theme";
import { ConfirmProvider } from "./_shared/ui/ConfirmDialog";

// 同一階層およびhooksから必要なパーツをインポート
import { useAuthAndMenu } from "./hooks/use-auth-and-menu";
import { PermissionGuard } from "./PermissionGuard";
import { SidebarNav } from "./_shared/ui/SidebarNav";
import { MenuItem } from "./types";

interface InjectedChildProps {
  userName?: string;
  isPartnerWfEnabled?: boolean;
  isQuoteWfEnabled?: boolean;
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isAuthPage =
    pathname === "/login" ||
    pathname === "/setup-init-admin" ||
    pathname === "/forgot-password" ||
    pathname === "/force-password-change" ||
    pathname === "/password-reset" ||
    // Item4-c: 見積書OTPダウンロード公開ページ(quoteId/attachmentIdはクエリパラメータで受け取る)
    pathname === "/quote-download" ||
    // Item6 Phase6-4: 出荷指示書/入荷指示書OTPダウンロード公開ページ(外部倉庫向け)
    pathname === "/shipment-instruction-download" ||
    pathname === "/receipt-instruction-download" ||
    // Item7: 注文請書OTPダウンロード公開ページ(取引先向け)
    pathname === "/order-download" ||
    // Item7残課題7: 納品書OTPダウンロード公開ページ(取引先向け)
    pathname === "/delivery-note-download" ||
    // Item9 Phase5: 発注書OTPダウンロード公開ページ(仕入先向け)。既存のisAuthPageリストから
    // 漏れていた(proxy.ts側は対応済みだったため実害は無いが、本来ここにも必要)
    pathname === "/purchase-order-download" ||
    // 検収書発行フォローアップ: 検収書OTPダウンロード公開ページ(仕入先向け)
    pathname === "/acceptance-inspection-download" ||
    // K-4-1: 売上関連書類OTPダウンロード公開ページ(取引先向け)
    pathname === "/sales-invoice-download" ||
    // 追加要望: 請求書OTPダウンロード公開ページ(取引先向け)
    pathname === "/billing-download";

  // 💡 1. 状態管理とデータフェッチは hooks/use-auth-and-menu.ts に一任
  const { user, loading, menuSections, flatScreens } =
    useAuthAndMenu(isAuthPage);

  const handleLogout = async () => {
    // セッションcookieはhttpOnlyのためJSからは削除できない。Backend側のSet-Cookieで失効させる。
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      console.error("ログアウト処理に失敗しました", err);
    }

    router.push("/login");
  };

  const hasMenuAccess = (resource: string): boolean => {
    if (!user) return false;
    if (user.roleId === "admin") return true;
    return user.permissions.includes(`${resource}:menu`);
  };

  const isSystemAdmin = user?.roleId === "admin";

  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-slate-50 h-dvh w-screen flex flex-col text-slate-900 overflow-hidden">
        <PermissionProvider value={{ user, flatScreens, loading }}>
          <ConfirmProvider>
          <ThemeProvider enabled={!isAuthPage && !!user}>
            <ScreenDescriptionProvider
              pathname={pathname}
              enabled={!isAuthPage && !!user}
            >
              {loading || (!isAuthPage && !user) ? (
                <div className="h-full w-full flex items-center justify-center text-slate-600 font-bold text-xs animate-pulse">
                  認証確認中... 🛡️
                </div>
              ) : (
                <>
                  {/* --- ヘッダー --- */}
                  {!isAuthPage && (
                    <header className="h-14 bg-white border-b border-slate-200 px-4 md:px-6 flex justify-between items-center shadow-sm w-full z-30 shrink-0">
                      <div className="flex items-center space-x-3">
                        {user && (
                          <button
                            onClick={() =>
                              setIsMobileMenuOpen(!isMobileMenuOpen)
                            }
                            className="h-11 w-11 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 md:hidden cursor-pointer focus:outline-none"
                          >
                            {isMobileMenuOpen ? "✕" : "☰"}
                          </button>
                        )}
                        <span
                          className="text-sm md:text-lg font-black text-indigo-600 cursor-pointer tracking-wider truncate"
                          onClick={() => router.push("/dashboard")}
                        >
                          {user ? user.companyName : "サンプル 販売管理"}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2 text-xs">
                        {user && (
                          <>
                            <div className="text-right hidden sm:block">
                              <div className="flex items-center justify-end space-x-1.5">
                                {isSystemAdmin && (
                                  <span className="text-[9px] bg-rose-50 border border-rose-200 text-rose-700 px-1 py-0.5 rounded font-black">
                                    ADMIN
                                  </span>
                                )}
                                <span className="font-bold text-slate-900">
                                  {user.name} 様
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-600 truncate max-w-[120px]">
                                {user.deptName}
                              </div>
                            </div>
                            <button
                              onClick={() => router.push("/profile")}
                              className="text-indigo-600 hover:underline font-semibold cursor-pointer"
                            >
                              プロフィール
                            </button>
                            <button
                              onClick={handleLogout}
                              title="ログアウト"
                              aria-label="ログアウト"
                              className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold px-2.5 py-1 rounded cursor-pointer"
                            >
                              {/* スマートフォンでは幅が足りないため、文字は画面が広い時だけ表示する(説明は title・aria-label) */}
                              🚪<span className="hidden sm:inline ml-1">ログアウト</span>
                            </button>
                          </>
                        )}
                      </div>
                    </header>
                  )}

                  <div className="flex-1 flex w-full min-h-0 overflow-hidden relative">
                    {!isAuthPage && isMobileMenuOpen && (
                      <div
                        className="fixed inset-x-0 bottom-0 top-14 bg-slate-900/40 backdrop-blur-xs z-40 md:hidden"
                        onClick={() => setIsMobileMenuOpen(false)}
                      />
                    )}

                    {/* --- サイドバー --- */}
                    {!isAuthPage && (
                      <aside
                        className={`bg-white border-r border-slate-200 flex flex-col justify-between shadow-md md:shadow-none z-40 md:z-20 shrink-0 md:h-full overflow-y-auto transition-transform duration-300 ease-in-out fixed md:static top-14 bottom-0 left-0 w-64
                      ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
                    `}
                      >
                        <div className="p-4 space-y-6">
                          <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider px-2 flex justify-between items-center">
                            <span>業務メニュー</span>
                          </div>

                          <SidebarNav
                            sections={menuSections}
                            canOpen={hasMenuAccess}
                            currentPath={pathname}
                            onNavigate={(path) => {
                              setIsMobileMenuOpen(false);
                              router.push(path);
                            }}
                          />
                        </div>
                      </aside>
                    )}

                    {/* --- メインコンテンツ領域 --- */}
                    <main className="flex-1 overflow-y-auto bg-slate-50 h-full min-w-0">
                      <div className="p-4 md:p-8 max-w-6xl w-full mx-auto">
                        {/* 💡 2. 認可ガード用のコンポーネントでラップ */}
                        <PermissionGuard
                          user={user}
                          flatScreens={flatScreens}
                          loading={loading}
                          isAuthPage={isAuthPage}
                        >
                          {React.isValidElement(children)
                            ? React.cloneElement(
                                children as React.ReactElement<InjectedChildProps>,
                                {
                                  userName: user?.name || "ユーザー",
                                  isPartnerWfEnabled:
                                    !loading &&
                                    user?.isPartnerWfEnabled === true,
                                  isQuoteWfEnabled:
                                    !loading && user?.isQuoteWfEnabled === true,
                                },
                              )
                            : children}
                        </PermissionGuard>
                      </div>
                    </main>
                  </div>
                </>
              )}
            </ScreenDescriptionProvider>
          </ThemeProvider>
          </ConfirmProvider>
        </PermissionProvider>
      </body>
    </html>
  );
}
