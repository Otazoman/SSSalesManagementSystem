import { getCompanySettings } from "../kv/company-settings-cache";
import { toTaxRoundingMode, type TaxRoundingMode } from "./compute-tax-amounts";

// BUG-042: 会社設定(KV)の消費税の端数処理。未設定・不正な値の場合は初期値(切り捨て)
export async function getTaxRoundingMode(kv: KVNamespace): Promise<TaxRoundingMode> {
  const settings = await getCompanySettings(kv);
  return toTaxRoundingMode(settings?.tax_rounding_mode);
}
