import { CodeNameLookup, IdNameLookup } from "../../../_shared/types/lookup";

export interface PriceRecord {
  id: string;
  itemId: string;
  priceType: "SALES" | "PURCHASE";
  partnerId: string | null;
  minQuantity: number;
  unitPrice: number;
  unitCode: string;
  status?: "temporary" | "active" | "suspended";
}

export type UnitLookup = CodeNameLookup;
// 商品マスタの基本単位(baseUnitCode)。単価設定の単位を商品マスタ側と連動させるために必要。
export interface MasterItem extends IdNameLookup {
  baseUnitCode: string;
}
export type MasterPartner = IdNameLookup;
