import { useState, useEffect } from "react";
import { apiFetch } from "./use-api-fetch";
import { DEFAULT_TAX_ROUNDING_MODE, toTaxRoundingMode, type TaxRoundingMode } from "../tax-amounts";

/**
 * BUG-042: 会社設定の消費税の端数処理(`tax_rounding_mode`)を取得する共通hook。
 * 見積・受注・売上・仕入計上・発注・購買申請のフォームで、消費税の表示に使う(usePaginationSetting と同じ方針)。
 * 取得できない場合は初期値(切り捨て)。保存する金額は Backend が会社設定で計算し直す。
 */
export function useTaxRoundingMode(): TaxRoundingMode {
  const [mode, setMode] = useState<TaxRoundingMode>(DEFAULT_TAX_ROUNDING_MODE);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ tax_rounding_mode?: string }>("/api/company-settings", {
      defaultErrorMessage: "会社設定の取得に失敗しました",
    })
      .then((settings) => {
        if (!cancelled) setMode(toTaxRoundingMode(settings.tax_rounding_mode));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return mode;
}
