export interface StructureRecord {
  id: string;
  parentItemId: string;
  parentItemName: string;
  childItemId: string;
  childItemName: string;
  childItemStatus: string;
  quantityRequired: number;
  revision: string;
  validFrom: string | number;
  validTo: string | number | null;
  memo: string | null;
  childUnitPrice: number;
  subTotalCost: number;
  status: "temporary" | "active" | "suspended";
}

// 商品構成ツリーの多階層表示用ノード。孫部品以下も再帰的に展開できるよう、
// structuresの親子エッジ(StructureRecord)をツリー状に組み替えたもの。
export interface BomTreeNode extends StructureRecord {
  depth: number;
  // ルート(最上位の親品番)を1として、経路上の員数を掛け合わせた実効員数
  effectiveQuantity: number;
  // effectiveQuantity × childUnitPrice(このノード1件分の積算原価)
  effectiveSubTotal: number;
  children: BomTreeNode[];
}

export interface ItemLookup {
  id: string;
  name: string;
  status: string;
}

export interface BomParentLookup {
  id: string;
  name: string;
}

export type FilterPeriodType = "current" | "expired" | "future" | "all";

export interface PeriodStatus {
  code: "current" | "expired" | "future";
  label: string;
  className: string;
}
