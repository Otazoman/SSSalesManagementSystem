import { useState, useEffect } from "react";
import { apiFetch } from "./use-api-fetch";

interface CompanySettingsPaginationFields {
  is_pagination_enabled?: boolean;
}

/**
 * 会社設定の`is_pagination_enabled`フラグを取得する共通hook。
 * ページネーションを使う機能（`use-paginated-list`/`Pagination`と併用）はすべてこれ経由で取得する
 * （company-settings取得を機能ごとに重複させない）。
 */
export function usePaginationSetting() {
  const [paginationEnabled, setPaginationEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const settings = await apiFetch<CompanySettingsPaginationFields>(
          "/api/company-settings",
          { defaultErrorMessage: "会社設定の取得に失敗しました" },
        );
        setPaginationEnabled(settings.is_pagination_enabled === true);
      } catch {
        setPaginationEnabled(false);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return { paginationEnabled, loading };
}
