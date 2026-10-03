// ==========================================================================
// schema-biz.ts: 業務トランザクション & 承認申請履歴
//
// 責務:
//   - 見積(quotes/quoteItems/...)、発注(purchaseRequests)、受注(orders)、入荷(itemReceipt*)、
//     在庫移動(stockTransactions)、仕訳(journalEntries)等の業務トランザクション本体
//   - マスタ変更承認申請の履歴(masterApprovalRequests/masterApprovalContexts)。
//     これは承認フローの「実行結果・履歴」であり、承認フローの「仕組み」自体はschema-workflow.tsが持つ
//
// 他ファイルとの関係:
//   - schema-core.ts: 参照先マスタ(partners/items/accounts等)
//   - schema-workflow.ts: 承認フローの汎用エンジン定義(approvalFlows等)。本ファイルのquotesはapprovalFlowIdで参照する
// ==========================================================================

import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
  AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { departments, partners, items, accounts, taxCategories, projects, warehouses, businessLocations, partnerDeliveryDestinations } from "./schema-core"; // 💡 partners に変更
import { approvalFlows } from "./schema-workflow";
import { withAuditColumns } from "./schema-helpers";

// ==========================================
// 4. 業務トランザクション & 申請履歴系
// ==========================================

// ==========================================
// 1. 見積ヘッダーテーブル
// ==========================================
export const quotes = sqliteTable("quotes", {
  id: text("id").primaryKey(),
  title: text("title"),
  partnerId: text("partner_id") // customer_id -> partner_id に変更
    .notNull()
    .references(() => partners.id),
  quoteDate: integer("quote_date", { mode: "timestamp" }).notNull(),
  validUntil: integer("valid_until", { mode: "timestamp" }),
  status: text("status").notNull().default("DRAFT"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  totalAmount: integer("total_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  memo: text("memo"),
  terms: text("terms"),
  companyName: text("company_name"),
  companyDepartment: text("company_department"),
  companyAddress: text("company_address"),
  companyTel: text("company_tel"),
  companyFax: text("company_fax"),
  deliveryDate: text("delivery_date"),
  deliveryPlace: text("delivery_place"),
  paymentTerms: text("payment_terms"),
  // Item4-d: 見積の自社担当者(営業担当)。監査用のupdatedBy(直近更新者のemployeeNumber、
  // Item1の全社統一方針)とは別概念のため専用列を新設(以前はupdatedByを兼用しており、
  // 他ユーザーが編集するたびに担当者が意図せず書き換わる不具合があった)。FK制約は他の
  // employeeNumber列と同様に付けない。
  salesPersonEmployeeNumber: text("sales_person_employee_number"),
  // Item7残課題(2026-08-27、見積へも展開): 営業担当(salesPersonEmployeeNumber)とは別概念の
  // 「実際にこの伝票を入力する担当者」。sales_ordersの同名列と同じ設計
  inputPersonEmployeeNumber: text("input_person_employee_number"),
  // 追加要望(2026-09-16ユーザー確認済み): 購買申請/発注と同じくプロジェクト単位の集計・
  // 引き継ぎができるようにする。受注作成時にそのまま引き継ぎ、売上計上まで伝播させる
  projectId: text("project_id").references(() => projects.id),
  ...withAuditColumns(),
});

export const quoteItems = sqliteTable("quote_items", {
  id: text("id").primaryKey(),
  quoteId: text("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  itemId: text("item_id"),
  itemName: text("item_name"),
  // Item4-d: 明細行がitemsマスタから選択されたもの(MASTER)か直接入力(DIRECT)かを保存する。
  // 以前は保存せずitemIdの文字列プレフィックス("PROD"始まり)で推測しており、実際の商品コード
  // 体系と合わないため常にDIRECT扱いになる不具合があった
  inputType: text("input_type"),
  quantity: real("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  costPrice: integer("cost_price"),
  amount: integer("amount").notNull(),
  // Item4-a/4-b: 単位はitemsマスタ(units)のコードをそのまま文字列で保持する(整合性チェックは行わない、参照目的のみ)
  unitCode: text("unit_code"),
  taxCategoryCode: text("tax_category_code").references(() => taxCategories.code),
  sortOrder: integer("sort_order").notNull().default(0),
  memo: text("memo"),
});

export const quoteAttachments = sqliteTable("quote_attachments", {
  id: text("id").primaryKey(),
  quoteId: text("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  attachmentR2Path: text("attachment_r2_path"),
  externalUrl: text("external_url"),
  fileType: text("file_type").notNull().default("OTHER"),
  uploadedById: text("uploaded_by_id").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

export const quoteHistoryLogs = sqliteTable("quote_history_logs", {
  id: text("id").primaryKey(),
  quoteId: text("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  action: text("action").notNull(),
  snapshotData: text("snapshot_data").notNull(),
  changedById: text("changed_by_id").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  changedAt: integer("changed_at", { mode: "timestamp" }).notNull(),
  comment: text("comment"),
});

// ==========================================
// 1b. 受注ヘッダーテーブル (Item7)
// ==========================================
// Item7: 見積を起点とするが、伝票分割はスナップショット方式(数量消込は行わない)。
// sourceQuoteIdは「どの見積由来か」の記録のみで、同じ見積から複数受注を起票することを妨げない
export const salesOrders = sqliteTable("sales_orders", {
  id: text("id").primaryKey(),
  title: text("title"),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id),
  sourceQuoteId: text("source_quote_id").references(() => quotes.id),
  orderDate: integer("order_date", { mode: "timestamp" }).notNull(),
  status: text("status").notNull().default("DRAFT"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  totalAmount: integer("total_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  memo: text("memo"),
  terms: text("terms"),
  companyName: text("company_name"),
  companyDepartment: text("company_department"),
  companyAddress: text("company_address"),
  companyTel: text("company_tel"),
  companyFax: text("company_fax"),
  deliveryDate: text("delivery_date"),
  deliveryPlace: text("delivery_place"),
  // 新規要望(2026-09-23): 取引先ごとの複数納品先(partner_delivery_destinations)からの選択
  // (あわせて上のdeliveryPlace自由入力も引き続き使える。選択時は名称をコピーする方式)
  deliveryDestinationId: text("delivery_destination_id").references(
    () => partnerDeliveryDestinations.id,
  ),
  paymentTerms: text("payment_terms"),
  salesPersonEmployeeNumber: text("sales_person_employee_number"),
  // Item7残課題: 営業担当(salesPersonEmployeeNumber、見積から引き継ぐ)とは別概念の
  // 「実際にこの伝票を入力する担当者」。手動選択可能な列で、新規作成時はログインユーザーを
  // 初期値とするが、見積からの受注作成時は営業担当と違いここへは引き継がない(要件により明確に区別)
  inputPersonEmployeeNumber: text("input_person_employee_number"),
  // Item7: 発行済み注文請書PDFのR2キー(SALES_ORDERS_BUCKET。分離前の既存分はQUATES_BUCKET、orders/プレフィックス)
  orderAcknowledgmentR2Path: text("order_acknowledgment_r2_path"),
  // Item7残課題6: 出荷指示/出庫との消込により算出される出荷進捗。承認ワークフローの
  // statusとは別概念(NOT_SHIPPED/PARTIALLY_SHIPPED/SHIPPED)。明細ごとの出荷済数量は
  // 都度集計するため列を持たないが、一覧表示・検索用にヘッダー側はこの列で可視化する
  shipmentStatus: text("shipment_status").notNull().default("NOT_SHIPPED"),
  // 前受の最小対応。発注のisPaid/paidAt(前払)と対称の設計で、入金完了を先に記録してから
  // 出荷・売上計上を待つ運用のマーカー。仕訳転記(前受金/売上への充当)の起点になる
  prepaidAt: integer("prepaid_at", { mode: "timestamp" }),
  isPrepaid: integer("is_prepaid", { mode: "boolean" }).notNull().default(false),
  // 追加要望(2026-09-16ユーザー確認済み): 見積からそのまま引き継ぎ、売上計上まで伝播させる
  projectId: text("project_id").references(() => projects.id),
  ...withAuditColumns(),
});

export const salesOrderItems = sqliteTable("sales_order_items", {
  id: text("id").primaryKey(),
  salesOrderId: text("sales_order_id")
    .notNull()
    .references(() => salesOrders.id, { onDelete: "cascade" }),
  // Item7: どの見積明細に由来するかの表示用トレーサビリティ。消込判定には使わない
  sourceQuoteItemId: text("source_quote_item_id").references(() => quoteItems.id),
  itemId: text("item_id"),
  itemName: text("item_name"),
  inputType: text("input_type"),
  quantity: real("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  costPrice: integer("cost_price"),
  amount: integer("amount").notNull(),
  unitCode: text("unit_code"),
  taxCategoryCode: text("tax_category_code").references(() => taxCategories.code),
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: text("account_code").references(() => accounts.code),
  sortOrder: integer("sort_order").notNull().default(0),
  memo: text("memo"),
  // Item7残課題2-5: 受注フォームでユーザーが指定した倉庫×数量の内訳リクエスト(JSON配列、
  // 例: [{"warehouseId":"WH-1","quantity":6}])。未指定(null)なら引当実行時に自動でFIFO割当する
  warehouseAllocationRequest: text("warehouse_allocation_request"),
  // Item7残課題2-5: 倉庫単位の引当で確保しきれなかった残数量(バックオーダー)。承認自体は
  // ブロックしない(与信警告と同じ非ブロッキング方針)。解消は在庫一覧/受注画面からの手動再引当のみ
  backorderedQuantity: real("backordered_quantity").notNull().default(0),
});

// Item7残課題2-5: 受注明細×倉庫の引当実績ledger(トレーサビリティ用)。
// warehouseStockReservations(schema-core.ts)が原子的な排他制御用の高速カウンタを担い、
// こちらは「どの受注のどの明細がどの倉庫からいくら引き当てたか」を保持する(stocks:stockTransactions
// と同じ「カウンタ+ledger」の関係)
export const salesOrderItemReservations = sqliteTable("sales_order_item_reservations", {
  id: text("id").primaryKey(),
  salesOrderItemId: text("sales_order_item_id")
    .notNull()
    .references(() => salesOrderItems.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id").notNull(),
  reservedQuantity: real("reserved_quantity").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const salesOrderAttachments = sqliteTable("sales_order_attachments", {
  id: text("id").primaryKey(),
  salesOrderId: text("sales_order_id")
    .notNull()
    .references(() => salesOrders.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  attachmentR2Path: text("attachment_r2_path"),
  externalUrl: text("external_url"),
  fileType: text("file_type").notNull().default("OTHER"),
  uploadedById: text("uploaded_by_id").notNull(),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

export const salesOrderHistoryLogs = sqliteTable("sales_order_history_logs", {
  id: text("id").primaryKey(),
  salesOrderId: text("sales_order_id")
    .notNull()
    .references(() => salesOrders.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  action: text("action").notNull(),
  snapshotData: text("snapshot_data").notNull(),
  changedById: text("changed_by_id").notNull(),
  changedAt: integer("changed_at", { mode: "timestamp" }).notNull(),
  comment: text("comment"),
});

// ==========================================
// 1c. 売上ヘッダーテーブル (Item8)
// ==========================================
// Item8: quotes/salesOrdersと同じ構造・承認フロー・仕訳連動パターンを踏襲する。
// salesOrderIdはnullable(受注に依存しない単独売上を許可)。受注/受注明細に紐付く場合も
// スナップショット方式(数量消込はsalesInvoiceItems.sourceOrderItemIdからの都度集計)。
// documentType!=SALEの場合(返品/値引/赤伝)はoriginalInvoiceIdで対象売上を指す(FK制約は
// 意図的に外している。実際にDELETE運用があるquotes/salesOrdersと異なり売上はAPPROVED後の
// 修正を新規伝票の起票で表現するため、自己参照FKの複雑さを避ける)
export const salesInvoices = sqliteTable("sales_invoices", {
  id: text("id").primaryKey(),
  title: text("title"),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id),
  salesOrderId: text("sales_order_id").references(() => salesOrders.id),
  invoiceDate: integer("invoice_date", { mode: "timestamp" }).notNull(),
  status: text("status").notNull().default("DRAFT"),
  // SALE=通常売上、RETURN=返品、DISCOUNT=値引、CORRECTION=赤伝(訂正)
  documentType: text("document_type").notNull().default("SALE"),
  // documentType!=SALEの場合に対象とする元売上伝票のid(参照目的のみ、FK制約なし)
  originalInvoiceId: text("original_invoice_id"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  totalAmount: integer("total_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  memo: text("memo"),
  companyName: text("company_name"),
  companyDepartment: text("company_department"),
  companyAddress: text("company_address"),
  companyTel: text("company_tel"),
  companyFax: text("company_fax"),
  paymentTerms: text("payment_terms"),
  salesPersonEmployeeNumber: text("sales_person_employee_number"),
  inputPersonEmployeeNumber: text("input_person_employee_number"),
  // Item8: 請求管理(Phase4)からの消込状況。売上計上と請求発行は別工程のため独立して持つ
  billingStatus: text("billing_status").notNull().default("UNBILLED"),
  // 追加要望(2026-09-16ユーザー確認済み): 受注からそのまま引き継ぐ。受注に依存しない単独売上の
  // 場合は手動選択できるようにする
  projectId: text("project_id").references(() => projects.id),
  ...withAuditColumns(),
});

export const salesInvoiceItems = sqliteTable("sales_invoice_items", {
  id: text("id").primaryKey(),
  salesInvoiceId: text("sales_invoice_id")
    .notNull()
    .references(() => salesInvoices.id, { onDelete: "cascade" }),
  // Item8: 受注単位/受注明細単位どちらでも売上を起こせるようにするための参照列。
  // 受注明細に紐付く場合、残数量チェック(is_sales_invoice_requires_shipment設定により
  // 受注数量 or 出荷済数量のどちらを基準にするか切替)に使う。単独売上の場合はnull
  sourceOrderItemId: text("source_order_item_id").references(() => salesOrderItems.id),
  itemId: text("item_id"),
  itemName: text("item_name"),
  inputType: text("input_type"),
  quantity: real("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  costPrice: integer("cost_price"),
  amount: integer("amount").notNull(),
  unitCode: text("unit_code"),
  taxCategoryCode: text("tax_category_code").references(() => taxCategories.code),
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: text("account_code").references(() => accounts.code),
  sortOrder: integer("sort_order").notNull().default(0),
  memo: text("memo"),
});

export const salesInvoiceAttachments = sqliteTable("sales_invoice_attachments", {
  id: text("id").primaryKey(),
  salesInvoiceId: text("sales_invoice_id")
    .notNull()
    .references(() => salesInvoices.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  attachmentR2Path: text("attachment_r2_path"),
  externalUrl: text("external_url"),
  fileType: text("file_type").notNull().default("OTHER"),
  uploadedById: text("uploaded_by_id").notNull(),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

export const salesInvoiceHistoryLogs = sqliteTable("sales_invoice_history_logs", {
  id: text("id").primaryKey(),
  salesInvoiceId: text("sales_invoice_id")
    .notNull()
    .references(() => salesInvoices.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  action: text("action").notNull(),
  snapshotData: text("snapshot_data").notNull(),
  changedById: text("changed_by_id").notNull(),
  changedAt: integer("changed_at", { mode: "timestamp" }).notNull(),
  comment: text("comment"),
});

// ==========================================
// 1d. 仕入(購買計上)ヘッダーテーブル (Item10)
// ==========================================
// Item10: sales_invoices(Item8)と完全に対称な構造。orderIdはnullable(発注に依存しない
// 単独仕入を許可)。発注/発注明細に紐付く場合もスナップショット方式(数量消込は
// purchaseRecognitionItems.sourceOrderItemIdからの都度集計)。
// documentType!=PURCHASEの場合(返品/値引/赤伝)はoriginalRecognitionIdで対象仕入を指す
// (FK制約は意図的に外している。sales_invoicesと同じ理由)
export const purchaseRecognitions = sqliteTable("purchase_recognitions", {
  id: text("id").primaryKey(),
  title: text("title"),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id),
  orderId: text("order_id").references(() => orders.id),
  recognitionDate: integer("recognition_date", { mode: "timestamp" }).notNull(),
  status: text("status").notNull().default("DRAFT"),
  // PURCHASE=通常仕入、RETURN=返品、DISCOUNT=値引、CORRECTION=赤伝(訂正)
  documentType: text("document_type").notNull().default("PURCHASE"),
  // documentType!=PURCHASEの場合に対象とする元仕入伝票のid(参照目的のみ、FK制約なし)
  originalRecognitionId: text("original_recognition_id"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  totalAmount: integer("total_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  memo: text("memo"),
  companyName: text("company_name"),
  companyDepartment: text("company_department"),
  companyAddress: text("company_address"),
  companyTel: text("company_tel"),
  companyFax: text("company_fax"),
  paymentTerms: text("payment_terms"),
  purchasePersonEmployeeNumber: text("purchase_person_employee_number"),
  inputPersonEmployeeNumber: text("input_person_employee_number"),
  // Item10: 支払管理(Phase5)からの消込状況。仕入計上と支払実行は別工程のため独立して持つ
  paymentStatus: text("payment_status").notNull().default("UNPAID"),
  // 追加要望(2026-09-16ユーザー確認済み): 発注からそのまま引き継ぐ。発注に依存しない単独仕入の
  // 場合は手動選択できるようにする
  projectId: text("project_id").references(() => projects.id),
  ...withAuditColumns(),
});

export const purchaseRecognitionItems = sqliteTable("purchase_recognition_items", {
  id: text("id").primaryKey(),
  purchaseRecognitionId: text("purchase_recognition_id")
    .notNull()
    .references(() => purchaseRecognitions.id, { onDelete: "cascade" }),
  // Item10: 発注単位/発注明細単位どちらでも仕入を起こせるようにするための参照列。
  // 発注明細に紐付く場合、残数量チェック(is_purchase_recognition_requires_receipt設定により
  // 発注数量 or 入荷済数量のどちらを基準にするか切替)に使う。単独仕入の場合はnull
  sourceOrderItemId: text("source_order_item_id").references(() => orderItems.id),
  itemId: text("item_id"),
  itemName: text("item_name"),
  inputType: text("input_type"),
  quantity: real("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  amount: integer("amount").notNull(),
  unitCode: text("unit_code"),
  taxCategoryCode: text("tax_category_code").references(() => taxCategories.code),
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: text("account_code").references(() => accounts.code),
  sortOrder: integer("sort_order").notNull().default(0),
  memo: text("memo"),
});

export const purchaseRecognitionAttachments = sqliteTable("purchase_recognition_attachments", {
  id: text("id").primaryKey(),
  purchaseRecognitionId: text("purchase_recognition_id")
    .notNull()
    .references(() => purchaseRecognitions.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  attachmentR2Path: text("attachment_r2_path"),
  externalUrl: text("external_url"),
  fileType: text("file_type").notNull().default("OTHER"),
  uploadedById: text("uploaded_by_id").notNull(),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

export const purchaseRecognitionHistoryLogs = sqliteTable("purchase_recognition_history_logs", {
  id: text("id").primaryKey(),
  purchaseRecognitionId: text("purchase_recognition_id")
    .notNull()
    .references(() => purchaseRecognitions.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  action: text("action").notNull(),
  snapshotData: text("snapshot_data").notNull(),
  changedById: text("changed_by_id").notNull(),
  changedAt: integer("changed_at", { mode: "timestamp" }).notNull(),
  comment: text("comment"),
});

// L-1-b: 仕入計上と検収記録(入庫)の紐づけ。同じ納品を「検収から」「仕入から」の両方で支払って
// 二重支払になるのを、支払候補の警告で防ぐための参照専用テーブル(仕入計上の登録・更新時に記録する)。
// 分納(検収複数→仕入1)に対応するため中間テーブルとした。既存データは未紐づけのまま
export const purchaseRecognitionReceipts = sqliteTable(
  "purchase_recognition_receipts",
  {
    id: text("id").primaryKey(),
    purchaseRecognitionId: text("purchase_recognition_id")
      .notNull()
      .references(() => purchaseRecognitions.id, { onDelete: "cascade" }),
    itemReceiptId: text("item_receipt_id")
      .notNull()
      .references(() => itemReceiptHeaders.id),
  },
  (table) => [
    uniqueIndex("purchase_recognition_receipts_unique").on(
      table.purchaseRecognitionId,
      table.itemReceiptId,
    ),
  ],
);

// ==========================================
// 1e. 請求管理テーブル (Item8 Phase4: billing)
// ==========================================
// Item8 Phase4: 既にAPPROVED確定済みのsales_invoicesを束ねて請求書を発行する専用テーブル。
// 承認ワークフローは持たない(束ねる対象自体が承認済みのため)。
// mode=PER_TRANSACTIONは対象sales_invoiceが常に1件(サービス層でバリデーション)、
// PERIODICは複数件を集約する(periodStart/periodEndで対象期間を記録)
export const billingHeaders = sqliteTable("billing_headers", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id),
  title: text("title"),
  billingDate: integer("billing_date", { mode: "timestamp" }).notNull(),
  // PER_TRANSACTION=都度請求(対象売上1件のみ)、PERIODIC=締め請求(複数売上を集約)
  mode: text("mode").notNull(),
  periodStart: integer("period_start", { mode: "timestamp" }),
  periodEnd: integer("period_end", { mode: "timestamp" }),
  status: text("status").notNull().default("DRAFT"),
  totalAmount: integer("total_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  // 手動消込(payment_receipts)の合計額。都度再計算してここへ非正規化保存する
  reconciledAmount: integer("reconciled_amount").notNull().default(0),
  reconciliationStatus: text("reconciliation_status").notNull().default("UNRECONCILED"),
  invoicePdfR2Path: text("invoice_pdf_r2_path"),
  memo: text("memo"),
  ...withAuditColumns(),
});

export const billingItems = sqliteTable("billing_items", {
  id: text("id").primaryKey(),
  billingHeaderId: text("billing_header_id")
    .notNull()
    .references(() => billingHeaders.id, { onDelete: "cascade" }),
  // 対象sales_invoice(束ねられる側)。作成時点の金額をスナップショットとして保持する。
  // K-4-3: 完全手動入力の行(明細を直接持つ)はnull(NOT NULL制約・FKを撤廃、2026-09-14)
  salesInvoiceId: text("sales_invoice_id").references(() => salesInvoices.id),
  amount: integer("amount").notNull(),
  taxAmount: integer("tax_amount").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // K-4-3: 売上計上を介さない完全手動の請求書入力用(salesInvoiceId未設定の行のみ使う明細スナップショット)
  itemName: text("item_name"),
  quantity: real("quantity"),
  unitPrice: integer("unit_price"),
  taxCategoryCode: text("tax_category_code").references(() => taxCategories.code),
});

// Item8 Phase4: 手動消込(入金記録)。銀行データCSV自動取込・全銀形式対応は別フェーズのため、
// 画面からの手入力のみを想定する
export const paymentReceipts = sqliteTable("payment_receipts", {
  id: text("id").primaryKey(),
  billingHeaderId: text("billing_header_id")
    .notNull()
    .references(() => billingHeaders.id, { onDelete: "cascade" }),
  receivedDate: integer("received_date", { mode: "timestamp" }).notNull(),
  amount: integer("amount").notNull(),
  // BANK_TRANSFER=銀行振込、CASH=現金、OTHER=その他
  method: text("method").notNull().default("BANK_TRANSFER"),
  memo: text("memo"),
  // V-4: 単体入金(cash_receipts)を請求へ紐づけて作られた入金消込の場合、その単体入金のid。
  // 現金は単体入金の時点で前受金として仕訳済みのため、仕訳の対象(入金)からは除外する
  cashReceiptId: text("cash_receipt_id").references((): AnySQLiteColumn => cashReceipts.id),
  reconciledById: text("reconciled_by_id").notNull(),
  reconciledAt: integer("reconciled_at", { mode: "timestamp" }).notNull(),
});

// ==========================================
// 1f. 支払管理テーブル (Item10 Phase5: payments)
// ==========================================
// Item10 Phase5: billing_headers/billing_items/payment_receipts(1e)と対称の設計。
// 既にAPPROVED確定済みのpurchase_recognitionsを束ねて支払を確定する専用テーブル。
// 承認ワークフローは持たない(束ねる対象自体が承認済みのため)。
// 適格請求書PDF発行に相当する要件は仕入側には無いため、PDF関連列・機能は持たない
// (検収書は既にPhase3のpurchase-recognitions側で発行済み)
export const paymentHeaders = sqliteTable("payment_headers", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id),
  title: text("title"),
  paymentDate: integer("payment_date", { mode: "timestamp" }).notNull(),
  // PER_TRANSACTION=都度支払(対象仕入1件のみ)、PERIODIC=締め支払(複数仕入を集約)
  mode: text("mode").notNull(),
  periodStart: integer("period_start", { mode: "timestamp" }),
  periodEnd: integer("period_end", { mode: "timestamp" }),
  status: text("status").notNull().default("DRAFT"),
  totalAmount: integer("total_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  // 手動消込(payment_disbursements)の合計額。都度再計算してここへ非正規化保存する
  reconciledAmount: integer("reconciled_amount").notNull().default(0),
  reconciliationStatus: text("reconciliation_status").notNull().default("UNRECONCILED"),
  memo: text("memo"),
  ...withAuditColumns(),
});

// K-5-1/K-5-3: purchaseRecognitionIdをnullable化し、検収記録(item_receipt_headers)への参照列
// itemNameを追加した(billing_itemsと同じnullable方式)。1明細は次の3パターンのいずれかを表す:
// (1) purchaseRecognitionId設定=仕入計上経由、(2) itemReceiptId設定=検収記録経由(仕入計上を介さない)、
// (3) 両方null=完全手動入力(itemNameに品目名を保持)。amountは常に税込金額で統一する(taxAmountは内訳)
export const paymentHeaderItems = sqliteTable("payment_header_items", {
  id: text("id").primaryKey(),
  paymentHeaderId: text("payment_header_id")
    .notNull()
    .references(() => paymentHeaders.id, { onDelete: "cascade" }),
  // 対象purchase_recognition(束ねられる側)。作成時点の金額をスナップショットとして保持する
  purchaseRecognitionId: text("purchase_recognition_id").references(() => purchaseRecognitions.id),
  // K-5-1: 対象item_receipt_header(検収記録)。仕入計上を介さず直接支払対象にする場合に設定する
  itemReceiptId: text("item_receipt_id").references(() => itemReceiptHeaders.id),
  // K-5-3: 完全手動入力行の品目名(purchaseRecognitionId/itemReceiptIdどちらもnullの場合のみ設定)
  itemName: text("item_name"),
  amount: integer("amount").notNull(),
  taxAmount: integer("tax_amount").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

// Item10 Phase5: 手動消込(支払実績記録)。銀行データCSV自動取込・全銀形式対応は別フェーズのため、
// 画面からの手入力のみを想定する
export const paymentDisbursements = sqliteTable("payment_disbursements", {
  id: text("id").primaryKey(),
  paymentHeaderId: text("payment_header_id")
    .notNull()
    .references(() => paymentHeaders.id, { onDelete: "cascade" }),
  paidDate: integer("paid_date", { mode: "timestamp" }).notNull(),
  amount: integer("amount").notNull(),
  // BANK_TRANSFER=銀行振込、CASH=現金、OTHER=その他
  method: text("method").notNull().default("BANK_TRANSFER"),
  memo: text("memo"),
  reconciledById: text("reconciled_by_id").notNull(),
  reconciledAt: integer("reconciled_at", { mode: "timestamp" }).notNull(),
});

// ==========================================
// 2. マスタ承認申請系
// ==========================================
export const masterApprovalRequests = sqliteTable("master_approval_requests", {
  id: text("id").primaryKey(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  requestType: text("request_type").notNull(),
  status: text("status").notNull(),
  // Item9 Phase2: startWorkflow()時点でマッチした承認フローを記録する(nullable、既存行は未設定のまま)。
  // processApproval()が次ステップ取得時に対象種別一致だけで再検索し、金額レンジ/matchFieldを
  // 無視してしまう不具合を修正するために追加。flowIdがnullの場合(移行前に作成されたPENDING申請)は
  // 従来通りtargetType一致の最初の有効フローにフォールバックする。
  flowId: text("flow_id").references(() => approvalFlows.id),
  // 追加要望F: 申請者が複数部門に所属する場合に選択した申請部門(nullable)。
  // startWorkflow()が申請者の所属部門であることを検証したうえでここに保存し、
  // 以降の承認者解決(resolveApprovers)は、承認フローのステップに部署指定が無い場合、
  // 申請時点で確定したこの値を一貫して使う(未設定ならuser_rolesからの推定にフォールバック)。
  applicantDepartmentSurrogateId: text(
    "applicant_department_surrogate_id",
  ).references(() => departments.surrogateId),
  applicantId: text("applicant_id").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  approverId: text("approver_id"), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  comment: text("comment"),
  attachmentR2Path: text("attachment_r2_path"),
  memo: text("memo"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const masterApprovalContexts = sqliteTable("master_approval_contexts", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => masterApprovalRequests.id),
  antiSocialCheckStatus: text("anti_social_check_status"),
  antiSocialCheckMemo: text("anti_social_check_memo"),
  contractType: text("contract_type"),
  contractValidFrom: integer("contract_valid_from", { mode: "timestamp" }),
  contractValidTo: integer("contract_valid_to", { mode: "timestamp" }),
  contractMemo: text("contract_memo"),
  drawingNumber: text("drawing_number"),
  specificationMemo: text("specification_memo"),
  generalMemo: text("general_memo"),
  ...withAuditColumns(),
});

// ==========================================
// 3. 購買申請系
// ==========================================
export const purchaseRequests = sqliteTable("purchase_requests", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  departmentSurrogateId: text("department_surrogate_id")
    .notNull()
    .references(() => departments.surrogateId),
  applicantId: text("applicant_id").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  requestType: text("request_type").notNull().default("CONSUMABLE"),
  status: text("status").notNull(),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  totalAmount: integer("total_amount").notNull(),
  memo: text("memo"),
  // Phase3フォローアップ: 購買申請自体に仕入先を持たせる(見積の得意先選択に相当)。
  // 品目と同じ「マスタ選択(MASTER)/手入力(DIRECT)」両対応のため、partnersマスタへのFK参照は
  // 維持しつつ(手入力時はnullのまま)nullable、partnerNameを手入力時の自由入力名として併設
  partnerId: text("partner_id").references(() => partners.id),
  partnerName: text("partner_name"),
  // "MASTER" | "DIRECT"。未設定はMASTER相当
  partnerInputType: text("partner_input_type"),
  // J-2-e(2026-09-13ユーザー確認済み): 勘定科目欄を廃止しプロジェクトに置き換えた
  projectId: text("project_id").references(() => projects.id),
  // 見積のinputPersonEmployeeNumberと同じ「申請者(applicantId)とは別の、実際に入力した担当者」
  inputPersonEmployeeNumber: text("input_person_employee_number"),
  // 見積と同じく税額を保存(合計totalAmountは税込)
  taxAmount: integer("tax_amount"),
  ...withAuditColumns(),
});

export const purchaseRequestItems = sqliteTable("purchase_request_items", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => purchaseRequests.id),
  // Phase3フォローアップ: quoteItemsと同じ「マスタ選択(MASTER)/手入力(DIRECT)」両対応のため、
  // NOT NULL+itemsマスタへのFK制約を撤廃(手入力時はマスタに存在しない値を保存する必要があるため)
  itemId: text("item_id"),
  quantity: real("quantity").notNull(),
  estimatedUnitPrice: integer("estimated_unit_price").notNull(),
  memo: text("memo"),
  // Item9: どの受注明細を満たすための調達かのトレーサビリティ(起票トリガー②受注紐付け)。
  // 任意起票(トリガー④)や欠品自動提案②(発注点方式)由来の行はnullのまま
  salesOrderItemId: text("sales_order_item_id").references(() => salesOrderItems.id),
  // Phase3フォローアップ: 見積のquoteItemsと同じ列構成に整合。unitCodeはFK無し(表示専用)
  unitCode: text("unit_code"),
  taxCategoryCode: text("tax_category_code").references(() => taxCategories.code),
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: text("account_code").references(() => accounts.code),
  sortOrder: integer("sort_order").notNull().default(0),
  // Phase3フォローアップ: quoteItemsと同じ「マスタ選択/手入力」両対応のための列。
  // itemNameは手入力(inputType="DIRECT")時の自由入力品目名(マスタ選択時は未設定)
  itemName: text("item_name"),
  // "MASTER"(itemsマスタから選択) | "DIRECT"(自由入力)。未設定の既存行はMASTER相当として扱う
  inputType: text("input_type"),
});

export const purchaseRequestAttachments = sqliteTable(
  "purchase_request_attachments",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => purchaseRequests.id),
    purchaseRequestItemId: text("purchase_request_item_id").references(
      () => purchaseRequestItems.id,
    ),
    fileName: text("file_name").notNull(),
    // Phase3フォローアップ: storageType="R2"以外(共有リンク)ではR2パスを持たないためnullable化
    attachmentR2Path: text("attachment_r2_path"),
    uploadedById: text("uploaded_by_id").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
    // Phase3フォローアップ: quoteAttachmentsと同じR2/外部URL(共有リンク)両対応
    storageType: text("storage_type").notNull().default("R2"),
    externalUrl: text("external_url"),
  },
);

// ==========================================
// 4. 発注・受入・在庫変動系
// ==========================================
export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  requestId: text("request_id").references(() => purchaseRequests.id),
  partnerId: text("partner_id").references(() => partners.id), // customer_id -> partner_id に変更
  orderDate: integer("order_date", { mode: "timestamp" }).notNull(),
  orderType: text("order_type").notNull().default("REGULAR"),
  status: text("status").notNull().default("DRAFT"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  memo: text("memo"),
  // Item9: 前払の最小対応。支払完了を先に記録してから納品を待つ運用のためのマーカーのみ
  // (本格的な支払管理・仕訳連携はItem10/11のスコープ)
  paidAt: integer("paid_at", { mode: "timestamp" }),
  isPaid: integer("is_paid", { mode: "boolean" }).notNull().default(false),
  // Phase5: sales_orders/purchase_requestsと同じ項目整合
  title: text("title"),
  totalAmount: integer("total_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  // J-2-e(2026-09-13ユーザー確認済み): 勘定科目欄を廃止しプロジェクトに置き換えた(purchase_requestsと同じ理由)
  projectId: text("project_id").references(() => projects.id),
  // 見積のsalesPersonEmployeeNumber/inputPersonEmployeeNumberと同じ2担当者分離。
  // 購買申請の申請者/入力者はそのまま引き継がず、発注固有の担当者として新規に持たせる(ユーザー確認済み)
  purchasePersonEmployeeNumber: text("purchase_person_employee_number"),
  inputPersonEmployeeNumber: text("input_person_employee_number"),
  // 発注書PDF印字用(quotesのCompanyAndTermsFieldsと同型)
  companyName: text("company_name"),
  companyDepartment: text("company_department"),
  companyAddress: text("company_address"),
  companyTel: text("company_tel"),
  companyFax: text("company_fax"),
  deliveryDate: text("delivery_date"),
  deliveryPlace: text("delivery_place"),
  // 新規要望(2026-09-23): 発注の納品場所を「拠点用」「倉庫用」の2つの独立した選択欄から選べる
  // ようにする(あわせて上のdeliveryPlace自由入力も引き続き使える)。選択時はdeliveryPlaceへ
  // 名称をコピーする方式(表示上の実体は従来どおりdeliveryPlace1本のまま、FK列は選択状態の
  // 保持・再表示用)。どちらか一方のみ選択される想定だが、DB制約としては両方nullable・排他制御なし
  deliveryLocationId: text("delivery_location_id").references(
    () => businessLocations.id,
  ),
  deliveryWarehouseId: text("delivery_warehouse_id").references(
    () => warehouses.id,
  ),
  paymentTerms: text("payment_terms"),
  // 発行済み発注書PDFのR2キー(sales_orders.orderAcknowledgmentR2Pathと同型)
  orderDocumentR2Path: text("order_document_r2_path"),
  ...withAuditColumns(),
});

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").references(() => orders.id),
  purchaseRequestItemId: text("purchase_request_item_id").references(
    () => purchaseRequestItems.id,
  ),
  // Phase5: purchase_request_itemsと同じ理由(手入力対応)でitemsマスタへのFK参照を撤廃
  itemId: text("item_id"),
  quantity: real("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  memo: text("memo"),
  // Item9: purchaseRequestItemId経由では辿れないケース(承認OFF時、購買申請を経由せず
  // 発注が直接受注に紐付けて起票される場合)のために、発注明細側にも独立して持たせる
  salesOrderItemId: text("sales_order_item_id").references(() => salesOrderItems.id),
  // Phase5: sales_order_itemsと同じマスタ選択/手入力両対応+単位/税区分/並べ替え
  itemName: text("item_name"),
  inputType: text("input_type"),
  unitCode: text("unit_code"),
  taxCategoryCode: text("tax_category_code").references(() => taxCategories.code),
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: text("account_code").references(() => accounts.code),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const orderAttachments = sqliteTable("order_attachments", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  orderItemId: text("order_item_id").references(() => orderItems.id),
  fileName: text("file_name").notNull(),
  // Phase5: storageType="R2"以外(共有リンク)ではR2パスを持たないためnullable化
  attachmentR2Path: text("attachment_r2_path"),
  fileType: text("file_type").notNull().default("OTHER"),
  uploadedById: text("uploaded_by_id").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
  // Phase5: quote_attachments/purchase_request_attachmentsと同じR2/共有リンク両対応
  storageType: text("storage_type").notNull().default("R2"),
  externalUrl: text("external_url"),
});

export const itemReceiptHeaders = sqliteTable("item_receipt_headers", {
  id: text("id").primaryKey(),
  orderId: text("order_id").references(() => orders.id),
  // Item6 Phase6-4: 仕入先(取引先マスタ)。自社倉庫の入庫では任意項目、外部倉庫の入荷実績では
  // 対応する入荷指示ヘッダーからコピーされる。nullable(取引先未指定の入庫を引き続き許容する)
  partnerId: text("partner_id").references(() => partners.id),
  // Item6 Phase6-4: 消込用。この実績がどの入荷指示に基づくものかを示す(任意、1指示:N実績)
  receiptInstructionId: text("receipt_instruction_id").references(
    (): AnySQLiteColumn => itemReceiptInstructions.id,
  ),
  receivedDate: integer("received_date", { mode: "timestamp" }).notNull(),
  supplierInvoiceNumber: text("supplier_invoice_number"),
  // 新規要望(2026-09-23): 倉庫間移動の入庫側。仕入先(partnerId)の代わりに、移動元となる
  // 自社/外部倉庫を指定できる(排他。両方同時に設定することはservice層で禁止する)
  sourceWarehouseId: text("source_warehouse_id").references(() => warehouses.id),
  attachmentR2Path: text("attachment_r2_path"),
  status: text("status").notNull().default("UNAPPROVED"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  memo: text("memo"),
  createdBy: text("created_by").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const itemReceiptItems = sqliteTable("item_receipt_items", {
  id: text("id").primaryKey(),
  receiptHeaderId: text("receipt_header_id").references(
    () => itemReceiptHeaders.id,
  ),
  orderItemId: text("order_item_id").references(() => orderItems.id),
  // Item6: orderItemId経由(order_items.itemId)でしか商品を特定できなかったため、
  // 発注非依存の入庫(Item6の確定方針)に対応するため直接のitemId参照を追加した
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  warehouseId: text("warehouse_id").notNull(),
  locationId: text("location_id").notNull(),
  lotNumber: text("lot_number").notNull().default("NONE"),
  receivedQuantity: real("received_quantity").notNull(),
  accountCode: text("account_code")
    .notNull()
    .references(() => accounts.code),
  inspectionStatus: text("inspection_status").notNull().default("PASSED"),
  inspectionMemo: text("inspection_memo"),
  actualProductPhotoR2Path: text("actual_product_photo_r2_path"),
  itemAttachmentR2Path: text("item_attachment_r2_path"),
  qrCodeKey: text("qr_code_key"),
  memo: text("memo"),
});

// 検収書発行: order_attachmentsと同型の複数バージョン管理テーブル(発注書と同じ方式)。
// item_receipt_headers.attachmentR2Path(単一列、仕入先請求書の添付用途)とは別枠で、
// PDF発行のたびに新しい行を追加する
export const itemReceiptAttachments = sqliteTable("item_receipt_attachments", {
  id: text("id").primaryKey(),
  receiptHeaderId: text("receipt_header_id")
    .notNull()
    .references(() => itemReceiptHeaders.id),
  receiptItemId: text("receipt_item_id").references(() => itemReceiptItems.id),
  fileName: text("file_name").notNull(),
  attachmentR2Path: text("attachment_r2_path"),
  fileType: text("file_type").notNull().default("OTHER"),
  uploadedById: text("uploaded_by_id").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  externalUrl: text("external_url"),
});

export const stockTransactions = sqliteTable("stock_transactions", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  locationId: text("location_id").notNull(),
  lotNumber: text("lot_number").notNull().default("NONE"),
  // Item6: 品質区分。"NORMAL" | "DAMAGED" | "QUARANTINE"。どの品質バケットに対する増減かを記録する
  qualityStatus: text("quality_status").notNull().default("NORMAL"),
  // 符号付き数量(増加=正、減少=負)。stocks.quantityとのクロスチェックに使う
  quantity: real("quantity").notNull(),
  type: text("type").notNull(), // 許容値はconstants/stock-transaction-types.tsで定義
  refId: text("ref_id"),
  qrCodeKey: text("qr_code_key"),
  memo: text("memo"),
  createdBy: text("created_by").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Item6: 出庫(item_receipt_headers/Itemsと対になる出庫版)
export const itemShipmentHeaders = sqliteTable("item_shipment_headers", {
  id: text("id").primaryKey(),
  // Item6 Phase6-4: 得意先(取引先マスタ)。設定時のみ出庫確定時に納品書・納品予定データを
  // 自動生成する(納品書発行のトリガー)。自社倉庫の出庫では任意項目、外部倉庫の出荷実績では
  // 対応する出荷指示ヘッダーからコピーされる。nullable
  partnerId: text("partner_id").references(() => partners.id),
  // Item6 Phase6-4: 消込用。この実績がどの出荷指示に基づくものかを示す(任意、1指示:N実績)。
  // 指示なしの単独実績登録(外部倉庫からの先方都合の実績報告等)も許容するためnullable
  shipmentInstructionId: text("shipment_instruction_id").references(
    (): AnySQLiteColumn => itemShipmentInstructions.id,
  ),
  // Item7: この出庫がどの受注に基づくものかを示す(任意)。受注に紐づく場合、明細側の
  // salesOrderItemId(itemShipmentItems)と合わせて消込・納品書への単価金額転記に使う
  salesOrderId: text("sales_order_id").references(() => salesOrders.id),
  // 新規要望(2026-09-23): 倉庫間移動の出庫側。得意先(partnerId)の代わりに、移動先となる
  // 自社/外部倉庫を指定できる(排他。両方同時に設定することはservice層で禁止する)
  destinationWarehouseId: text("destination_warehouse_id").references(() => warehouses.id),
  shippedDate: integer("shipped_date", { mode: "timestamp" }).notNull(),
  status: text("status").notNull().default("UNAPPROVED"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  memo: text("memo"),
  // Item6 Phase6-4: 自動生成された納品書PDFのR2キー(SYSTEM_BUCKET)。partnerId設定済みの
  // 出庫が確定(APPROVED)したタイミングで自動生成される。null=未生成(partnerId未設定等)
  deliveryNoteR2Path: text("delivery_note_r2_path"),
  createdBy: text("created_by").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const itemShipmentItems = sqliteTable("item_shipment_items", {
  id: text("id").primaryKey(),
  shipmentHeaderId: text("shipment_header_id").references(
    () => itemShipmentHeaders.id,
  ),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  // Item7: この明細がどの受注明細を消込対象とするか(任意)。同一商品を複数行・異なる単価で
  // 持ちうる受注明細を(itemId, lotNumber)だけでは一意に特定できないため、直接FKで紐付ける
  salesOrderItemId: text("sales_order_item_id").references(
    (): AnySQLiteColumn => salesOrderItems.id,
  ),
  warehouseId: text("warehouse_id").notNull(),
  locationId: text("location_id").notNull(),
  lotNumber: text("lot_number").notNull().default("NONE"),
  qualityStatus: text("quality_status").notNull().default("NORMAL"),
  shippedQuantity: real("shipped_quantity").notNull(),
  accountCode: text("account_code")
    .notNull()
    .references(() => accounts.code),
  qrCodeKey: text("qr_code_key"),
  memo: text("memo"),
});

// Item6 Phase6-4: 出荷指示(外部倉庫向け)。承認確定しても在庫は動かさず、ステータスを
// APPROVED(発行済み)にするのみ(在庫反映は実績側=item_shipment_headersが担う)。
// 1指示:N実績(分納対応)のため、実績側(item_shipment_headers.shipmentInstructionId)に
// 指示IDを持たせる設計とし、こちら側には実績IDを持たない
export const itemShipmentInstructions = sqliteTable("item_shipment_instructions", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id), // 得意先
  warehouseId: text("warehouse_id").notNull(), // EXTERNAL倉庫想定(業務チェックはservice層)
  instructedShipDate: integer("instructed_ship_date", { mode: "timestamp" }).notNull(),
  // UNAPPROVED -> APPROVED(発行済み) -> PARTIALLY_FULFILLED -> FULFILLED、他REMANDED/CANCELED
  status: text("status").notNull().default("UNAPPROVED"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  instructionDocumentR2Path: text("instruction_document_r2_path"), // 発行済みPDFのR2キー(SYSTEM_BUCKET)
  // Item7: この出荷指示がどの受注に基づくものかを示す(任意)
  salesOrderId: text("sales_order_id").references(() => salesOrders.id),
  memo: text("memo"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const itemShipmentInstructionItems = sqliteTable("item_shipment_instruction_items", {
  id: text("id").primaryKey(),
  instructionHeaderId: text("instruction_header_id").references(
    () => itemShipmentInstructions.id,
  ),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  // Item7: この明細がどの受注明細を消込対象とするか(任意)。itemShipmentItemsと同じ理由でFK直接紐付け
  salesOrderItemId: text("sales_order_item_id").references(
    (): AnySQLiteColumn => salesOrderItems.id,
  ),
  // 外部倉庫の内部ロケーション体系は自社のlocationsマスタと無関係のためlocationIdは持たない
  lotNumber: text("lot_number").notNull().default("NONE"),
  instructedQuantity: real("instructed_quantity").notNull(),
  accountCode: text("account_code")
    .notNull()
    .references(() => accounts.code),
  memo: text("memo"),
});

// Item6 Phase6-4: 入荷指示(外部倉庫向け)。出荷指示と対称構造(partnerIdは仕入先)
export const itemReceiptInstructions = sqliteTable("item_receipt_instructions", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id), // 仕入先
  warehouseId: text("warehouse_id").notNull(),
  instructedReceiveDate: integer("instructed_receive_date", { mode: "timestamp" }).notNull(),
  status: text("status").notNull().default("UNAPPROVED"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  instructionDocumentR2Path: text("instruction_document_r2_path"),
  memo: text("memo"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const itemReceiptInstructionItems = sqliteTable("item_receipt_instruction_items", {
  id: text("id").primaryKey(),
  instructionHeaderId: text("instruction_header_id").references(
    () => itemReceiptInstructions.id,
  ),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  lotNumber: text("lot_number").notNull().default("NONE"),
  instructedQuantity: real("instructed_quantity").notNull(),
  accountCode: text("account_code")
    .notNull()
    .references(() => accounts.code),
  memo: text("memo"),
});

// Item6 Phase6-4: 出荷指示書PDF(quote_attachmentsと同型、専用R2バケットSHIPMENT_INSTRUCTIONS_BUCKET+
// 専用attachmentsテーブルの構成を踏襲。OTPダウンロード配布に使う)
export const shipmentInstructionAttachments = sqliteTable("shipment_instruction_attachments", {
  id: text("id").primaryKey(),
  instructionId: text("instruction_id")
    .notNull()
    .references(() => itemShipmentInstructions.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  attachmentR2Path: text("attachment_r2_path"),
  fileType: text("file_type").notNull().default("PDF"),
  uploadedById: text("uploaded_by_id").notNull(),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

// Item6 Phase6-4: 入荷指示書PDF(shipmentInstructionAttachmentsと対称)
export const receiptInstructionAttachments = sqliteTable("receipt_instruction_attachments", {
  id: text("id").primaryKey(),
  instructionId: text("instruction_id")
    .notNull()
    .references(() => itemReceiptInstructions.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  attachmentR2Path: text("attachment_r2_path"),
  fileType: text("file_type").notNull().default("PDF"),
  uploadedById: text("uploaded_by_id").notNull(),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

// Item6 Phase6-3: 棚卸(在庫調整)。入出庫と異なり複数行を束ねて1申請にする業務要件が無く、
// 「1ロケーション=1品目」という既存制約とも整合するため、ヘッダー+明細ではなく
// 1行=1回の棚卸実施(1ロケーション×1品目)のフラットな構造にする。
export const stockAudits = sqliteTable("stock_audits", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  warehouseId: text("warehouse_id").notNull(),
  locationId: text("location_id").notNull(),
  lotNumber: text("lot_number").notNull().default("NONE"),
  accountCode: text("account_code")
    .notNull()
    .references(() => accounts.code),
  qualityStatus: text("quality_status").notNull().default("NORMAL"),
  // 実施時点のstocks.quantityスナップショット(未登録在庫なら0)
  theoreticalQuantity: real("theoretical_quantity").notNull(),
  // 実棚数(手入力)
  countedQuantity: real("counted_quantity").notNull(),
  // counted - theoretical(符号付き)。stock_transactions.quantityにそのまま渡す
  differenceQuantity: real("difference_quantity").notNull(),
  status: text("status").notNull().default("UNAPPROVED"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  memo: text("memo"),
  qrCodeKey: text("qr_code_key"),
  createdBy: text("created_by").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Item6 Phase6-3: 品質区分変更(破損・不良品管理)。stock_auditsと同様、1行=1回の
// 変更実施(1ロケーション×1品目×1移動)のフラットな構造。良品⇔破損品/検品待ちの
// どちらの向きの変更も在庫価値評価に影響するため承認対象とする(is_damage_approval_enabled)。
// targetTypeは入出庫と同じ"inventory_stock"を共有する(inventory-stock.adapter.ts参照)。
export const stockReclassifications = sqliteTable("stock_reclassifications", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  warehouseId: text("warehouse_id").notNull(),
  locationId: text("location_id").notNull(),
  lotNumber: text("lot_number").notNull().default("NONE"),
  accountCode: text("account_code")
    .notNull()
    .references(() => accounts.code),
  fromQualityStatus: text("from_quality_status").notNull(),
  toQualityStatus: text("to_quality_status").notNull(),
  quantity: real("quantity").notNull(),
  status: text("status").notNull().default("UNAPPROVED"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  memo: text("memo"),
  createdBy: text("created_by").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Item6 Phase6-3-3: 廃棄決定。在庫を最終的に消滅させる操作のため承認対象とする
// (is_disposal_approval_enabled)。stock_audits/stock_reclassificationsと同様、
// 1行=1回の廃棄実施(1ロケーション×1品目)のフラットな構造。品質区分は問わない
// (良品の期限切れ・過剰在庫の廃棄等も対象、破損品に限定しない)。
// targetTypeは入出庫と同じ"inventory_stock"を共有する(inventory-stock.adapter.ts参照)。
export const stockDisposals = sqliteTable("stock_disposals", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  warehouseId: text("warehouse_id").notNull(),
  locationId: text("location_id").notNull(),
  lotNumber: text("lot_number").notNull().default("NONE"),
  accountCode: text("account_code")
    .notNull()
    .references(() => accounts.code),
  qualityStatus: text("quality_status").notNull().default("NORMAL"),
  quantity: real("quantity").notNull(),
  status: text("status").notNull().default("UNAPPROVED"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  memo: text("memo"), // 廃棄理由
  createdBy: text("created_by").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Item6 Phase6-3-3: 返品(仕入先へ返品/得意先から返品の両方向、品質区分は問わない)。
// 在庫を増減させる操作のため承認対象とする(is_return_approval_enabled)。
// directionで方向を持つ以外はstock_disposalsと同型のフラット1行=1回の返品。
// targetTypeは入出庫と同じ"inventory_stock"を共有する(inventory-stock.adapter.ts参照)。
export const stockReturns = sqliteTable("stock_returns", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  warehouseId: text("warehouse_id").notNull(),
  locationId: text("location_id").notNull(),
  lotNumber: text("lot_number").notNull().default("NONE"),
  accountCode: text("account_code")
    .notNull()
    .references(() => accounts.code),
  qualityStatus: text("quality_status").notNull().default("NORMAL"),
  // "OUTBOUND" = 仕入先へ返品(自社在庫減少) / "INBOUND" = 得意先から返品(自社在庫増加)
  direction: text("direction").notNull(),
  quantity: real("quantity").notNull(),
  returnReason: text("return_reason"),
  returnDate: integer("return_date", { mode: "timestamp" }).notNull(),
  status: text("status").notNull().default("UNAPPROVED"),
  currentApprovalLayer: integer("current_approval_layer").notNull().default(1),
  approvalFlowId: text("approval_flow_id").references(() => approvalFlows.id),
  memo: text("memo"),
  createdBy: text("created_by").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ==========================================
// 5. 会計・外部連携系
// ==========================================

// 仕訳転記の起票イベント(outbox)。
// 仕訳本体は別DB(DB_JOURNAL、src/db/journal-schema.ts)にあり、D1はDB跨ぎの
// トランザクションを張れない。そのため「伝票を前払済にする」「検収を確定する」等の
// 更新と同一トランザクションで、このテーブルへ起票イベントを1行書く(ここは同じDBなので原子的)。
// そのうえで同じリクエスト内でDB_JOURNALへ転記し、成功したらPOSTEDへ更新する。
// ユーザー確認済み: 転記はバッチ(Cron等の自動処理)にはしない。転記に失敗した行はFAILEDのまま残し、
// 人が明示的に「再転記」操作を行った時(=そのユーザー操作というアクション)にのみ再試行する。
// これにより「伝票だけ進んで仕訳が欠落する」状態が原理的に発生せず、かつ自動再試行の
// 意図しないタイミングでの実行(二重計上・過去会計期間への誤転記等)も起きない
export const journalPostingEvents = sqliteTable(
  "journal_posting_events",
  {
    id: text("id").primaryKey(), // UUID
    // journal_batchesと同じ3つ組。転記先バッチの冪等キーでもある
    sourceType: text("source_type").notNull(),
    sourceRefId: text("source_ref_id").notNull(),
    eventType: text("event_type").notNull(),
    // 転記に必要な情報(計上日・摘要・借貸明細)の確定スナップショットをJSONで保持する。
    // 再試行時に元伝票を読み直すと、その間の伝票変更が過去の会計事象に混入するため、
    // 起票時点の内容をここに固定する
    payload: text("payload").notNull(),
    // 'PENDING' | 'PROCESSING' | 'POSTED' | 'FAILED'
    status: text("status").notNull().default("PENDING"),
    postedBatchId: text("posted_batch_id"), // 転記先(DB_JOURNAL)のjournal_batches.id
    // 人が「再転記」操作を行った回数(自動リトライは無いため、スケジューラ用の次回試行時刻は持たない)
    retryCount: integer("retry_count").notNull().default(0),
    errorMessage: text("error_message"),
    requestedById: text("requested_by_id").notNull(), // employeeNumber
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
    postedAt: integer("posted_at", { mode: "timestamp" }),
  },
  (table) => [
    // 同じ会計事象の起票イベントを重複して作らない(二重転記の第一の防波堤。
    // DB_JOURNAL側のjournal_batches_source_uniqueが第二の防波堤になる)
    uniqueIndex("journal_posting_events_source_unique").on(
      table.sourceType,
      table.sourceRefId,
      table.eventType,
    ),
    // 「未転記(FAILED)一覧」画面での抽出用(人が手動で再転記対象を探す)
    index("journal_posting_events_status_idx").on(table.status),
  ],
);

// 旧・単一借方/単一貸方の1行型仕訳テーブル。参照するルートは存在せず未使用。
// 消費税を分けた多行仕訳(借方: 仕入 + 仮払消費税 / 貸方: 買掛金)が表現できないため、
// 複式構造(journal_batches + journal_lines、DB_JOURNAL側)へ置き換えた。
// 既存migrationを壊さないよう定義自体は残すが、新規の書き込みは行わない
export const journalEntries = sqliteTable("journal_entries", {
  id: text("id").primaryKey(),
  entryDate: integer("entry_date", { mode: "timestamp" }).notNull(),
  debitAccountCode: text("debit_account_code")
    .notNull()
    .references(() => accounts.code),
  debitAmount: integer("debit_amount").notNull(),
  creditAccountCode: text("credit_account_code")
    .notNull()
    .references(() => accounts.code),
  creditAmount: integer("credit_amount").notNull(),
  description: text("description").notNull(),
  sourceRefId: text("source_ref_id"),
  memo: text("memo"),
  createdBy: text("created_by").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const mailTemplateSettings = sqliteTable("mail_template_settings", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  smtpFrom: text("smtp_from"),
  ccAddress: text("cc_address"),
  bccAddress: text("bcc_address"),
  subjectTemplate: text("subject_template").notNull(),
  bodyTemplate: text("body_template").notNull(),
  reportTemplatePath: text("report_template_path"),
  // Item4-a: xlsx→layout.jsonコンパイル状態(Cron+outboxで非同期処理、CPU制限が理由でリクエスト内では実行しない)
  reportLayoutPath: text("report_layout_path"),
  reportLayoutStatus: text("report_layout_status", {
    enum: ["PENDING", "READY", "FAILED"],
  }),
  reportLayoutError: text("report_layout_error"),
  // 追加要望L-3-b/c: 帳票PDFのファイル名プレフィックス(「プレフィックス_伝票番号.pdf」)。nullは既定の日本語名
  fileNamePrefix: text("file_name_prefix"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  updatedBy: text("updated_by"),
});

// ==========================================
// Item12-2/12-4: 進捗確認の担当者設定
// ==========================================

// 工程ごとの既定担当(「この工程は誰が担当するか」の設定)。stageKeyは進捗確認の12工程キー
// (quote/sales_order/purchase_request/purchase_order/receipt_instruction/item_receipt/
// purchase_recognition/shipment_instruction/item_shipment/sales_invoice/billing/payment)。
// assigneeType='USER'ならassigneeRef=社員番号、'ROLE'ならassigneeRef=ロールID
export const progressStageOwners = sqliteTable("progress_stage_owners", {
  stageKey: text("stage_key").primaryKey(),
  assigneeType: text("assignee_type").notNull(),
  assigneeRef: text("assignee_ref").notNull(),
  ...withAuditColumns(),
});

// 案件×工程の個別割当(工程の既定担当を上書きする)。rootKind/rootIdは進捗確認の「案件の起点伝票」
export const progressCaseAssignments = sqliteTable(
  "progress_case_assignments",
  {
    id: text("id").primaryKey(),
    rootKind: text("root_kind").notNull(),
    rootId: text("root_id").notNull(),
    stageKey: text("stage_key").notNull(),
    employeeNumber: text("employee_number").notNull(),
    ...withAuditColumns(),
  },
  (table) => [
    uniqueIndex("progress_case_assignments_unique").on(table.rootKind, table.rootId, table.stageKey),
  ],
);

// ==========================================
// 追加要望L-1-a: 単体入金(請求を介さない入金)
// ==========================================
// 請求書に紐づかずに登録できる入金の記録(ユーザー確認済み: 新テーブルで入金ヘッダーを作り、後から請求へ紐づけ)。
// 既存のpayment_receipts(請求への入金消込。billingHeaderIdが必須)は変更しない。
// 請求へ紐づけると、既存の入金消込ロジック(BillingReconciliationService)でpayment_receiptsへ反映される。
// status: UNLINKED(未紐づけ) / LINKED(請求に紐づけ済み)
export const cashReceipts = sqliteTable("cash_receipts", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id),
  receiptDate: integer("receipt_date", { mode: "timestamp" }).notNull(),
  amount: integer("amount").notNull(),
  // BANK_TRANSFER / CASH / OTHER(payment_receiptsと同じ)
  method: text("method").notNull().default("BANK_TRANSFER"),
  memo: text("memo"),
  status: text("status").notNull().default("UNLINKED"),
  billingHeaderId: text("billing_header_id").references(() => billingHeaders.id),
  linkedAt: integer("linked_at", { mode: "timestamp" }),
  ...withAuditColumns(),
});

// V-4: 単体入金の前受金を、売上を仕訳にするときに充当した記録(売上ごと・単体入金ごとの充当額)。
// 単体入金は入金時に前受金として仕訳し(借方=現金預金/貸方=前受金)、売上を仕訳にする時に
// 振り替える(V-5以降は、売上を売掛金で計上したうえで 借方=前受金/貸方=売掛金)。単体入金ごとの未充当残=入金額-充当額の合計
export const cashReceiptAdvanceApplications = sqliteTable("cash_receipt_advance_applications", {
  id: text("id").primaryKey(),
  cashReceiptId: text("cash_receipt_id")
    .notNull()
    .references(() => cashReceipts.id),
  salesInvoiceId: text("sales_invoice_id")
    .notNull()
    .references(() => salesInvoices.id),
  amount: integer("amount").notNull(),
  appliedById: text("applied_by_id").notNull(),
  appliedAt: integer("applied_at", { mode: "timestamp" }).notNull(),
});

// 追加要望M-2-a: 進捗確認の「完了/進行中」の手動上書き(案件×工程)。分納・複数計上などで自動判定と
// 実態が合わない場合に、担当者が「完了にする」「進行中に戻す」を指定する。
// forcedState: COMPLETED / IN_PROGRESS(上書きを解除する場合は行を削除する)
export const progressCaseStageOverrides = sqliteTable(
  "progress_case_stage_overrides",
  {
    id: text("id").primaryKey(),
    rootKind: text("root_kind").notNull(),
    rootId: text("root_id").notNull(),
    stageKey: text("stage_key").notNull(),
    forcedState: text("forced_state").notNull(),
    ...withAuditColumns(),
  },
  (table) => [
    uniqueIndex("progress_case_stage_overrides_unique").on(table.rootKind, table.rootId, table.stageKey),
  ],
);

// 伝票単位の「完了/進行中」の手動設定。進捗確認は閲覧専用のため、更新は各伝票の画面から行い、
// 進捗確認はこの値を読んで工程の状態に反映する(自動判定が実態と合わない場合の補正: 分納・複数計上など)。
// stageKeyは進捗確認の工程キー(quote / sales_order / ... / payment)。forcedState: COMPLETED / IN_PROGRESS
// (設定を解除する場合は行を削除する)。上の案件×工程の上書き(progress_case_stage_overrides)は使わなくなった
export const documentCompletionOverrides = sqliteTable(
  "document_completion_overrides",
  {
    id: text("id").primaryKey(),
    stageKey: text("stage_key").notNull(),
    documentId: text("document_id").notNull(),
    forcedState: text("forced_state").notNull(),
    ...withAuditColumns(),
  },
  (table) => [
    uniqueIndex("document_completion_overrides_unique").on(table.stageKey, table.documentId),
  ],
);
