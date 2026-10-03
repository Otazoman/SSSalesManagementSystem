// document-types.tsと同じ方針(会社設定でコードフォーマットを種別ごとに設定可能にする対象一覧)。
// マスタは伝票と概念が異なる(種類が固定小数の伝票に対し、マスタは性質上ルール採番になじむものだけを
// 対象に絞る、ユーザー確認済み)ため、document_number_formatsとは別のmaster_code_formatsキーで管理する。
export interface MasterTypeDefinition {
  key: string;
  label: string;
  defaultPrefix: string;
}

export const MASTER_TYPES: MasterTypeDefinition[] = [
  { key: "partners", label: "取引先", defaultPrefix: "PT" },
  { key: "partner_contacts", label: "取引先担当者", defaultPrefix: "PC" },
  { key: "products", label: "品目", defaultPrefix: "PRD" },
  { key: "warehouses", label: "倉庫", defaultPrefix: "WH" },
  { key: "projects", label: "プロジェクト", defaultPrefix: "PJ" },
  { key: "business_locations", label: "営業拠点", defaultPrefix: "BL" },
];
