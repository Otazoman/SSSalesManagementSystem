/**
 * targetType(masterApprovalRequests.targetType 等)ごとに、承認ワークフローの
 * 「対象マスタ固有の処理」を差し込むためのレジストリ(Strategyパターン)。
 *
 * 汎用エンジン(workflow-engine/engine.ts)・通知(notifier.ts)・設定(settings.ts)は
 * targetTypeを知らない完全に汎用な実装だが、以下の2箇所だけは元々特定のマスタ
 * (partners)にハードコードされていた(docs/target-architecture.md 6.7章参照)。
 *   1. 申請提出時の金額解決(承認フロー分岐判定に使う金額をどう求めるか)
 *   2. 最終承認確定時に実マスタテーブルへ反映する処理
 * このレジストリはその2箇所と、承認タスク一覧・履歴画面のプレビュー表示ロジックを
 * targetTypeごとに差し替え可能にする。
 *
 * 他マスタ(products/units/accounts等)へ承認フローを拡張する場合、このファイルを
 * 変更せず、新しいadapterファイルを追加してregistryに登録するだけで済む設計とする。
 */

import type { Context } from "hono";
import { partnersAdapter } from "./partners.adapter";
import { quotesAdapter } from "./quotes.adapter";
import { salesOrdersAdapter } from "./sales-orders.adapter";
import { salesInvoicesAdapter } from "./sales-invoices.adapter";
import { purchaseRequisitionsAdapter } from "./purchase-requisitions.adapter";
import { purchaseOrdersAdapter } from "./purchase-orders.adapter";
import { purchaseRecognitionsAdapter } from "./purchase-recognitions.adapter";
import { partnerContactsAdapter } from "./partner-contacts.adapter";
import { unitsAdapter } from "./units.adapter";
import { locationsAdapter } from "./locations.adapter";
import { productPricesAdapter } from "./product-prices.adapter";
import { productsAdapter } from "./products.adapter";
import { accountsAdapter } from "./accounts.adapter";
import { warehousesAdapter } from "./warehouses.adapter";
import { businessLocationsAdapter } from "./business-locations.adapter";
import { itemStructuresAdapter } from "./item-structures.adapter";
import { inventoryStockAdapter } from "./inventory-stock.adapter";
import { inventoryAuditAdapter } from "./inventory-audit.adapter";

export interface ResolveAmountParams {
  db: any;
  targetId: string;
  isRegister: boolean;
  payload: Record<string, any>;
}

export interface ApplyApprovedParams {
  db: any;
  reqParent: {
    id: string;
    targetId: string;
    targetType: string;
    requestType: string;
    applicantId: string;
  };
  userId: string;
  now: Date;
  /** R2等のbindingが必要なadapter(例: 見積のDELETE承認確定)向け。既存adapterは未使用で問題ない */
  c?: Context;
  /**
   * applyRemandedの呼び出し元が「承認者による差戻し(REMAND)」「申請者による取り下げ(CANCEL)」の
   * どちらかを明示するための追加コンテキスト(workflow-tasks.service.tsのremandTask/cancelTaskが設定する)。
   * 未指定の場合は既存adapter(quotes/warehouses等)は無視して従来通り動作するため後方互換。
   */
  action?: "REMAND" | "CANCEL";
}

export interface TaskPreviewParams {
  db: any;
  requestId: string;
  targetId: string;
}

export interface TaskPreviewResult {
  targetName: string;
  previewData: unknown;
}

export interface HistoryPreviewParams {
  db: any;
  requestId: string;
  targetId: string;
  requestType: string;
}

export interface HistoryPreviewResult {
  targetName: string;
  snapshotNew: unknown;
  snapshotOld: unknown;
}

export interface ResolveEditPathParams {
  db: any;
  targetType: string;
  targetId: string;
}

export interface TargetAdapter {
  /** 申請提出時の金額解決。未定義の場合は常に0として扱う(=金額レンジ0のフローにのみ一致) */
  resolveAmount?(params: ResolveAmountParams): Promise<number>;
  /** 最終承認確定時に実マスタテーブルへ反映する */
  applyApproved(params: ApplyApprovedParams): Promise<void>;
  /** 差戻し確定時に実マスタ/伝票テーブルへ反映する(例: 見積を申請中状態からDRAFTへ戻す)。未定義の場合は何もしない */
  applyRemanded?(params: ApplyApprovedParams): Promise<void>;
  /** 承認タスク一覧(自分の承認待ち)でのプレビュー表示情報を解決する */
  getTaskPreview?(params: TaskPreviewParams): Promise<TaskPreviewResult>;
  /** 承認履歴画面でのプレビュー表示情報を解決する */
  getHistoryPreview?(params: HistoryPreviewParams): Promise<HistoryPreviewResult>;
  /**
   * 「修正して再提出」ボタンの遷移先パスを動的に解決する(1つのtargetTypeが複数の画面に
   * 分散している場合向け)。未定義、またはnullを返した場合は呼び出し元がscreens.tsの
   * 静的な1対1マッピングへフォールバックする
   */
  resolveEditPath?(params: ResolveEditPathParams): Promise<string | null>;
  /**
   * BUG-049: 承認・差戻し・取下げでは、手番・申請の書き込みと、このアダプターの書き込みを1回の batch にまとめる。
   * ただし、書き込みの結果を使う処理(在庫の条件付き減算・引当など)や、DB 以外(R2)の後始末を含むアダプターは
   * まとめられないため true にする。true の場合は、このアダプターを先に(その場で書き込んで)実行し、成功した後に
   * 手番・申請を書き込む(失敗した場合は申請が承認待ちのまま残る)
   */
  requiresImmediateWrites?: boolean;
}

const registry: Record<string, TargetAdapter> = {
  master_partners: partnersAdapter,
  sales_quotes: quotesAdapter,
  sales_orders: salesOrdersAdapter,
  sales_invoices: salesInvoicesAdapter,
  purchase_requisitions: purchaseRequisitionsAdapter,
  purchase_orders: purchaseOrdersAdapter,
  purchase_recognitions: purchaseRecognitionsAdapter,
  master_contacts: partnerContactsAdapter,
  master_units: unitsAdapter,
  master_locations: locationsAdapter,
  master_prices: productPricesAdapter,
  master_products: productsAdapter,
  master_accounts: accountsAdapter,
  master_warehouses: warehousesAdapter,
  master_business_locations: businessLocationsAdapter,
  master_structures: itemStructuresAdapter,
  inventory_stock: inventoryStockAdapter,
  // Item6 Phase6-4: 出荷指示/入荷指示は画面分割(/inventory/instructions)に伴い専用targetTypeへ
  // 分離したが、承認確定時の実処理(applyApproved等)は入出庫と同じinventoryStockAdapterの
  // プローブチェーンで処理できるため、adapter実装自体は複製せず同じオブジェクトを指す
  inventory_instructions: inventoryStockAdapter,
  inventory_audit: inventoryAuditAdapter,
};

export function getTargetAdapter(targetType: string): TargetAdapter | undefined {
  return registry[targetType];
}
