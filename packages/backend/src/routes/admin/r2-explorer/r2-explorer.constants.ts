import { Env } from "../../../types/env";

// Item13-a: R2参照機能。既存のmail-settings/r2-explorer(見積・システムバケットのみに限定した
// フォント/ロゴ選択用ピッカー)とは別の、全バケットを横断的にブラウズできる汎用の管理画面。
// 既存のピッカーは変更しない(用途が異なるため)。
export interface R2BucketDescriptor {
  key: string;
  label: string;
  getBucket: (env: Env) => R2Bucket;
}

export const R2_BUCKET_REGISTRY: R2BucketDescriptor[] = [
  { key: "system", label: "システム(フォント・ロゴ・印影ほか)", getBucket: (env) => env.SYSTEM_BUCKET },
  { key: "quotes", label: "見積添付", getBucket: (env) => env.QUATES_BUCKET },
  { key: "products", label: "品目添付", getBucket: (env) => env.PRODUCTS_BUCKET },
  { key: "partners", label: "取引先添付", getBucket: (env) => env.PARTNERS_BUCKET },
  { key: "warehouses", label: "倉庫添付", getBucket: (env) => env.WAREHOUSES_BUCKET },
  {
    key: "shipmentInstructions",
    label: "出荷指示書添付",
    getBucket: (env) => env.SHIPMENT_INSTRUCTIONS_BUCKET,
  },
  {
    key: "receiptInstructions",
    label: "入荷指示書添付",
    getBucket: (env) => env.RECEIPT_INSTRUCTIONS_BUCKET,
  },
  {
    key: "purchaseRequisitions",
    label: "購買申請添付",
    getBucket: (env) => env.PURCHASE_REQUISITIONS_BUCKET,
  },
  { key: "purchaseOrders", label: "発注書添付", getBucket: (env) => env.PURCHASE_ORDERS_BUCKET },
  { key: "salesOrders", label: "受注添付・注文請書", getBucket: (env) => env.SALES_ORDERS_BUCKET },
  { key: "salesInvoices", label: "売上添付・売上計上書", getBucket: (env) => env.SALES_INVOICES_BUCKET },
  { key: "billing", label: "請求書", getBucket: (env) => env.BILLING_BUCKET },
  {
    key: "purchaseRecognitions",
    label: "仕入計上添付・仕入計上書",
    getBucket: (env) => env.PURCHASE_RECOGNITIONS_BUCKET,
  },
  {
    key: "acceptanceInspections",
    label: "検収書",
    getBucket: (env) => env.ACCEPTANCE_INSPECTIONS_BUCKET,
  },
  { key: "deals", label: "商談添付", getBucket: (env) => env.DEALS_BUCKET },
];

export function resolveBucket(env: Env, bucketKey: string): R2Bucket | null {
  const descriptor = R2_BUCKET_REGISTRY.find((b) => b.key === bucketKey);
  return descriptor ? descriptor.getBucket(env) : null;
}
