// hooks/use-auth-and-menu.ts
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { UserState, MenuItem, MenuSection } from "../types";
import { apiFetchShared, ApiFetchError } from "../_shared/hooks/use-api-fetch";

// 以前の res.json() と同じ型(応答の中身をそのまま扱う)
type ResponseJson = Awaited<ReturnType<Response["json"]>>;

export function useAuthAndMenu(isAuthPage: boolean) {
  const pathname = usePathname();
  const [user, setUser] = useState<UserState | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuSections, setMenuSections] = useState<MenuSection[]>([]);
  const [flatScreens, setFlatScreens] = useState<MenuItem[]>([]);

  useEffect(() => {
    async function fetchUserProfileAndMenus() {
      if (isAuthPage) {
        setLoading(false);
        return;
      }
      try {
        // PERF-06: 画面を移るたびに呼ばれるため、30秒間は同じ結果を使い回す(apiFetchShared)。
        // ログイン・ログアウト・会社設定の保存の時は破棄している
        const [profileResult, screensResult] = await Promise.allSettled([
          apiFetchShared<ResponseJson>("/api/auth/profile"),
          apiFetchShared<ResponseJson>("/api/permissions/screens"),
        ]);
        const isUnauthorized = (r: PromiseSettledResult<unknown>) =>
          r.status === "rejected" && r.reason instanceof ApiFetchError && r.reason.status === 401;

        // 💡 明確な未認証(401)の場合のみログイン画面へ強制遷移させる。
        // それ以外(5xx・wrangler devの一時的な接続断など)はcatch節で処理し、
        // セッションCookie自体は有効なまま強制ログアウトしないようにする
        // (以前は下のcatch節が「fetch自体の失敗」も「401」も区別せず全てログイン画面へ
        // 飛ばしていたため、開発環境でwrangler devの接続が一瞬途切れただけで
        // ログイン中のセッションが強制的に破棄されているように見える不具合があった)
        if (isUnauthorized(profileResult) || isUnauthorized(screensResult)) {
          setUser(null);
          if (!isAuthPage) window.location.href = "/login";
          return;
        }

        if (profileResult.status === "rejected") throw profileResult.reason;
        if (screensResult.status === "rejected") throw screensResult.reason;

        const profileData = profileResult.value;
        const screensData = screensResult.value;

        const normalizedRoleId = (
          profileData.roleId || "general_user"
        ).toLowerCase();
        const rawScreens = screensData.map((s: any) => ({
          title: s.name,
          icon: s.icon || "📄",
          path: s.path || "#",
          resource: s.resource,
          category: s.category,
        }));

        setUser({
          id: profileData.id,
          employeeNumber: profileData.employeeNumber || "",
          name: profileData.name || "未設定ユーザー",
          roleId: normalizedRoleId,
          deptName: profileData.deptName || "未配属",
          companyName: profileData.companyName || "サンプル 販売管理",
          permissions: profileData.permissions || [],
          departments: profileData.departments || [],
          isPartnerWfEnabled: profileData.isPartnerWfEnabled || false,
          isQuoteWfEnabled: profileData.isQuoteWfEnabled || false,
          isPartnerContactWfEnabled:
            profileData.isPartnerContactWfEnabled || false,
          isUnitWfEnabled: profileData.isUnitWfEnabled || false,
          isLocationWfEnabled: profileData.isLocationWfEnabled || false,
          isProductPriceWfEnabled:
            profileData.isProductPriceWfEnabled || false,
          isProductWfEnabled: profileData.isProductWfEnabled || false,
          isAccountWfEnabled: profileData.isAccountWfEnabled || false,
          isWarehouseWfEnabled: profileData.isWarehouseWfEnabled || false,
          isBusinessLocationWfEnabled:
            profileData.isBusinessLocationWfEnabled || false,
          isItemStructureWfEnabled:
            profileData.isItemStructureWfEnabled || false,
          isReceivingWfEnabled: profileData.isReceivingWfEnabled || false,
          isShippingWfEnabled: profileData.isShippingWfEnabled || false,
          isInventoryWfEnabled: profileData.isInventoryWfEnabled || false,
          isDamageWfEnabled: profileData.isDamageWfEnabled || false,
          isDisposalWfEnabled: profileData.isDisposalWfEnabled || false,
          isReturnWfEnabled: profileData.isReturnWfEnabled || false,
          isShippingInstructionWfEnabled: profileData.isShippingInstructionWfEnabled || false,
          isShippingResultWfEnabled: profileData.isShippingResultWfEnabled || false,
          isReceivingInstructionWfEnabled: profileData.isReceivingInstructionWfEnabled || false,
          isReceivingResultWfEnabled: profileData.isReceivingResultWfEnabled || false,
          isSalesOrderWfEnabled: profileData.isSalesOrderWfEnabled || false,
          isPurchaseRequisitionWfEnabled:
            profileData.isPurchaseRequisitionWfEnabled || false,
          isPurchaseOrderWfEnabled: profileData.isPurchaseOrderWfEnabled || false,
          isSalesInvoiceWfEnabled: profileData.isSalesInvoiceWfEnabled || false,
          isPurchaseRecognitionWfEnabled:
            profileData.isPurchaseRecognitionWfEnabled || false,
        });
        setFlatScreens(rawScreens);

        // セクション構築ロジック
        setMenuSections([
          {
            sectionTitle: "申請・承認",
            items: rawScreens.filter(
              (s: any) => s.category === "apply_approve",
            ),
          },
          {
            sectionTitle: "日常業務",
            items: rawScreens.filter((s: any) => s.category === "daily_work"),
          },
          {
            sectionTitle: "経理・統制",
            items: rawScreens.filter((s: any) => s.category === "accounting"),
          },
          {
            sectionTitle: "ログ",
            items: rawScreens.filter((s: any) => s.category === "log"),
          },
          {
            sectionTitle: "業務マスタ設定",
            items: rawScreens.filter(
              (s: any) => s.category === "business_master",
            ),
          },
          {
            sectionTitle: "基本マスタ設定",
            items: rawScreens.filter(
              (s: any) => s.category === "system_master",
            ),
          },
        ]);
      } catch (err) {
        // 💡 ここに来るのは「fetch自体が失敗した(ネットワーク一時エラー等)」または
        // 「401以外のエラーレスポンス」の場合。どちらも未認証と断定できないため、
        // 強制ログアウト・ログイン画面遷移はしない(上の401判定ブロックのみが遷移を担当する)
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    void fetchUserProfileAndMenus();
  }, [pathname, isAuthPage]);

  return { user, loading, menuSections, flatScreens };
}
