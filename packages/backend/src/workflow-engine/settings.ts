import { KVNamespace } from "@cloudflare/workers-types";

/**
 * 会社一括設定：取引先マスタのワークフロー承認機能が有効化されているかを即時判定する
 * (旧is_master_approval_enabled/isMasterWorkflowGloballyEnabled。Item5で他マスタが
 * 個別のフラグに分かれた後もこのフラグだけ汎用的な「master」名のまま取り残されており、
 * 実態は取引先専用のフラグだったため、実情に合わせてpartner名へ改名した)
 * 💡 修正点：引数の型を any にすることで、Hono内部とWorkers-types間の型の競合を完全に防ぎます
 */
export async function isPartnerWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;

  try {
    // 💡 1. まず一括設定が保存されている "config" キーを取得します
    const configStr = await kv.get("config");
    if (!configStr) return false;

    // 💡 2. 文字列からJSONオブジェクトへ変換します
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;

    // 💡 3. オブジェクトの中にある本物の承認フラグをジャッジします
    return (
      parsed.is_partner_approval_enabled === true ||
      parsed.is_partner_approval_enabled === "true"
    );
  } catch (error) {
    console.error("取引先ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item4-e: 見積の承認ワークフローが会社設定で有効化されているかを判定する。
 * is_partner_approval_enabledとは別に、伝票種別ごとの粒度で持つis_quote_approval_enabledを見る
 * (旧is_document_approval_enabledという単一グローバルフラグを伝票種別ごとに置き換えたもの)。
 */
export async function isQuoteWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;

  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;

    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;

    return (
      parsed.is_quote_approval_enabled === true ||
      parsed.is_quote_approval_enabled === "true"
    );
  } catch (error) {
    console.error("見積承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * 承認機能の一括設定のON/OFFに応じて、新規登録時の初期ステータスを動的に決定する共通関数
 */
export async function determineInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isPartnerWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

/**
 * Item5: 各マスタ承認機能横展開(取引先担当者/単位/ロケーション)。
 * is_partner_approval_enabledとは別に、マスタ種別ごとの粒度で持つ
 * is_partner_contact_approval_enabled/is_unit_approval_enabled/is_location_approval_enabled を見る
 * (company-settings.schema.tsには既存定義済みだったが、これまでどこからも参照されていなかった)。
 */
export async function isPartnerContactWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_partner_contact_approval_enabled === true ||
      parsed.is_partner_contact_approval_enabled === "true"
    );
  } catch (error) {
    console.error("取引先担当者承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function isUnitWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_unit_approval_enabled === true ||
      parsed.is_unit_approval_enabled === "true"
    );
  } catch (error) {
    console.error("単位承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function isLocationWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_location_approval_enabled === true ||
      parsed.is_location_approval_enabled === "true"
    );
  } catch (error) {
    console.error("ロケーション承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function determinePartnerContactInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isPartnerContactWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

export async function determineUnitInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isUnitWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

export async function determineLocationInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isLocationWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

/**
 * 残り6マスタへの展開(商品/商品単価/勘定科目/倉庫)。is_product_approval_enabled等は
 * company-settings.schema.tsに既存プレースホルダーとして定義済みだったが、これまで
 * どこからも参照されていなかった。
 */
export async function isProductWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_product_approval_enabled === true ||
      parsed.is_product_approval_enabled === "true"
    );
  } catch (error) {
    console.error("品目承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function isProductPriceWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_product_price_approval_enabled === true ||
      parsed.is_product_price_approval_enabled === "true"
    );
  } catch (error) {
    console.error("品目単価承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function isAccountWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_account_approval_enabled === true ||
      parsed.is_account_approval_enabled === "true"
    );
  } catch (error) {
    console.error("勘定科目承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function isWarehouseWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_warehouse_approval_enabled === true ||
      parsed.is_warehouse_approval_enabled === "true"
    );
  } catch (error) {
    console.error("倉庫承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Phase6: 商品構成マスタ(BOM)への展開。is_item_structure_approval_enabledは
 * company-settings.schema.tsに既存プレースホルダーとして定義済みだったが、これまで
 * どこからも参照されていなかった。
 */
export async function isItemStructureWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_item_structure_approval_enabled === true ||
      parsed.is_item_structure_approval_enabled === "true"
    );
  } catch (error) {
    console.error("品目構成承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function determineItemStructureInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isItemStructureWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

export async function determineProductInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isProductWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

export async function determineProductPriceInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isProductPriceWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

export async function determineAccountInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isAccountWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

export async function determineWarehouseInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isWarehouseWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

// 新規要望: 営業拠点マスタ(2026-09-23新設)
export async function isBusinessLocationWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_business_location_approval_enabled === true ||
      parsed.is_business_location_approval_enabled === "true"
    );
  } catch (error) {
    console.error("営業拠点承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function determineBusinessLocationInitialStatus(
  kv: any,
): Promise<"temporary" | "active"> {
  const isEnabled = await isBusinessLocationWorkflowGloballyEnabled(kv);
  return isEnabled ? "temporary" : "active";
}

/**
 * Item6: 在庫マスタ(自社倉庫の入庫/出庫/棚卸調整)。伝票種別の粒度で持つ
 * is_receiving_approval_enabled/is_shipping_approval_enabled/is_inventory_approval_enabled を見る。
 * company-settings.schema.tsに既存プレースホルダーとして定義済みだったが、これまで
 * どこからも参照されていなかった(quotesと同じ「伝票UNAPPROVED→APPROVED」パターンのため、
 * temporary/active方式のdetermineXxxInitialStatusは持たない。呼び出し元のservice層で
 * このフラグを直接見てUNAPPROVED/APPROVEDを決定する)。
 */
export async function isReceivingWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_receiving_approval_enabled === true ||
      parsed.is_receiving_approval_enabled === "true"
    );
  } catch (error) {
    console.error("入庫承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function isShippingWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_shipping_approval_enabled === true ||
      parsed.is_shipping_approval_enabled === "true"
    );
  } catch (error) {
    console.error("出庫承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

export async function isInventoryAdjustmentWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_inventory_approval_enabled === true ||
      parsed.is_inventory_approval_enabled === "true"
    );
  } catch (error) {
    console.error("棚卸調整承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item6 Phase6-3-2: 品質区分変更(破損・不良品管理)。良品⇔破損品/検品待ちのどちらの
 * 向きの変更もこのフラグでON/OFFする(is_receiving/is_shippingとは独立)。
 * targetTypeは入出庫と同じ"inventory_stock"を共有するため、承認フロー設定自体は
 * 別途追加不要(inventory-stock.adapter.tsのreclassifications probe参照)。
 */
export async function isDamageWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_damage_approval_enabled === true ||
      parsed.is_damage_approval_enabled === "true"
    );
  } catch (error) {
    console.error("品質区分変更承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item6 Phase6-3-3: 廃棄決定。在庫を最終的に消滅させる操作のため独立のフラグでON/OFFする。
 * targetTypeは入出庫と同じ"inventory_stock"を共有するため、承認フロー設定自体は
 * 別途追加不要(inventory-stock.adapter.tsのdisposals probe参照)。
 */
export async function isDisposalWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_disposal_approval_enabled === true ||
      parsed.is_disposal_approval_enabled === "true"
    );
  } catch (error) {
    console.error("廃棄決定承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item6 Phase6-3-3: 返品(仕入先へ返品/得意先から返品の両方向)。在庫を増減させる操作のため
 * 独立のフラグでON/OFFする(方向を問わず同じフラグで制御する)。targetTypeは入出庫と同じ
 * "inventory_stock"を共有するため、承認フロー設定自体は別途追加不要
 * (inventory-stock.adapter.tsのreturns probe参照)。
 */
export async function isReturnWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_return_approval_enabled === true ||
      parsed.is_return_approval_enabled === "true"
    );
  } catch (error) {
    console.error("返品承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item6 Phase6-4: 外部倉庫向け出荷指示の発行承認。in-app用にPENDING中は指示書PDFを
 * 発行させない(inventory-stock.adapter.tsのshipment instruction probe参照)。
 */
export async function isShippingInstructionWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_shipping_instruction_approval_enabled === true ||
      parsed.is_shipping_instruction_approval_enabled === "true"
    );
  } catch (error) {
    console.error("出荷指示発行承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item6 Phase6-4: 外部倉庫からの出荷実績反映承認。自社倉庫の出庫承認
 * (isShippingWorkflowGloballyEnabled)とは別フラグで、warehouseType==="EXTERNAL"の
 * 場合にshipments.service.tsが参照する。
 */
export async function isShippingResultWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_shipping_result_approval_enabled === true ||
      parsed.is_shipping_result_approval_enabled === "true"
    );
  } catch (error) {
    console.error("出荷実績反映承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item6 Phase6-4: 外部倉庫向け入荷指示の発行承認。
 */
export async function isReceivingInstructionWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_receiving_instruction_approval_enabled === true ||
      parsed.is_receiving_instruction_approval_enabled === "true"
    );
  } catch (error) {
    console.error("入荷指示発行承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item6 Phase6-4: 外部倉庫からの入荷実績反映承認。自社倉庫の入庫承認
 * (isReceivingWorkflowGloballyEnabled)とは別フラグで、warehouseType==="EXTERNAL"の
 * 場合にreceipts.service.tsが参照する。
 */
export async function isReceivingResultWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_receiving_result_approval_enabled === true ||
      parsed.is_receiving_result_approval_enabled === "true"
    );
  } catch (error) {
    console.error("入荷実績反映承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item7: 受注の承認ワークフローが会社設定で有効化されているかを判定する。
 * ON時のみsales-order-crud.service.tsのsubmitForApprovalが与信確認(creditLimitとの比較)を行う。
 */
export async function isSalesOrderWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_sales_order_approval_enabled === true ||
      parsed.is_sales_order_approval_enabled === "true"
    );
  } catch (error) {
    console.error("受注承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item9 Phase5: 発注の承認ワークフローが会社設定で有効化されているかを判定する。
 * is_purchase_order_approval_enabledはcompany-settings.schema.tsに既存プレースホルダーとして
 * 定義済みだったが、これまでどこからも参照されていなかった。
 */
export async function isPurchaseOrderWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_purchase_order_approval_enabled === true ||
      parsed.is_purchase_order_approval_enabled === "true"
    );
  } catch (error) {
    console.error("発注承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item9 Phase3: 購買申請の承認ワークフローが会社設定で有効化されているかを判定する。
 * quotes/sales_ordersと同じ「DRAFT→PENDING_APPROVAL→APPROVED」パターンのため、
 * determineXxxInitialStatus(temporary/active方式)は持たない。
 */
export async function isPurchaseRequisitionWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_purchase_requisition_approval_enabled === true ||
      parsed.is_purchase_requisition_approval_enabled === "true"
    );
  } catch (error) {
    console.error("購買申請承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item8: 売上の承認ワークフローが会社設定で有効化されているかを判定する。
 * is_sales_approval_enabledはcompany-settings.schema.tsに既存プレースホルダーとして
 * 定義済みだったが、これまでどこからも参照されていなかった。
 */
export async function isSalesInvoiceWorkflowGloballyEnabled(kv: any): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_sales_approval_enabled === true ||
      parsed.is_sales_approval_enabled === "true"
    );
  } catch (error) {
    console.error("売上承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}

/**
 * Item10: 仕入の承認ワークフローが会社設定で有効化されているかを判定する。
 * is_purchase_approval_enabledはcompany-settings.schema.tsに既存プレースホルダーとして
 * 定義済みだったが、これまでどこからも参照されていなかった。
 */
export async function isPurchaseRecognitionWorkflowGloballyEnabled(
  kv: any,
): Promise<boolean> {
  if (!kv) return false;
  try {
    const configStr = await kv.get("config");
    if (!configStr) return false;
    const parsed = JSON.parse(configStr);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      parsed.is_purchase_approval_enabled === true ||
      parsed.is_purchase_approval_enabled === "true"
    );
  } catch (error) {
    console.error("仕入承認ワークフロー設定のパースに失敗しました:", error);
    return false;
  }
}
