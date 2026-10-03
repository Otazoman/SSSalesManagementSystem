import { ProgressStageKey } from "../_types";

// 進捗確認から各伝票の「元の画面」を開くURLを組み立てる。
//  - editId: 既存の入口(承認履歴の「修正して再提出」と同じ)。伝票の編集/詳細フォームが開く
//  - openId(+openKind): 「参照として開く」入口(請求・支払の詳細モーダル、在庫系の一覧の行展開)
const DOCUMENT_ROUTES: Record<ProgressStageKey, { path: string; param: "editId" | "openId"; openKind?: string }> = {
  quote: { path: "/sales/quotes", param: "editId" },
  sales_order: { path: "/sales/orders", param: "editId" },
  sales_invoice: { path: "/sales/invoices", param: "editId" },
  billing: { path: "/sales/billing", param: "openId" },
  purchase_request: { path: "/purchase/requisitions", param: "editId" },
  purchase_order: { path: "/purchase/orders", param: "editId" },
  purchase_recognition: { path: "/purchase/receipts", param: "editId" },
  payment: { path: "/purchase/payment", param: "openId" },
  receipt_instruction: { path: "/inventory/receiving", param: "openId", openKind: "instruction" },
  item_receipt: { path: "/inventory/receiving", param: "openId", openKind: "receipt" },
  shipment_instruction: { path: "/inventory/shipping", param: "openId", openKind: "instruction" },
  item_shipment: { path: "/inventory/shipping", param: "openId", openKind: "shipment" },
};

export function buildDocumentHref(stage: ProgressStageKey, id: string): string {
  const route = DOCUMENT_ROUTES[stage];
  const query = `${route.param}=${encodeURIComponent(id)}${route.openKind ? `&openKind=${route.openKind}` : ""}`;
  return `${route.path}?${query}`;
}
