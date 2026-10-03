// ==========================================================================
// schema-core.ts: 組織・権限・マスタデータの基盤
//
// 責務:
//   - 組織構造(users, departments, roles, permissions, userRoles, rolePermissions)
//   - 各種マスタ(units, partners, accounts, taxCategories, items, warehouses, locations, stocks)
//
// 他ファイルとの関係:
//   - schema-workflow.ts: 承認フローエンジンの汎用定義(どの業務からも参照される再利用可能な仕組み)
//   - schema-biz.ts: 業務トランザクション本体(quotes等)と、マスタ変更承認申請の履歴(masterApprovalRequests等)
//
// 配置の判断基準: 「マスタデータ」であればこのファイル、「日々発生する業務トランザクション」ならschema-biz.tsへ
// ==========================================================================

import { sql } from "drizzle-orm/sql/sql";
import {
  AnySQLiteColumn,
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { withAuditColumns } from "./schema-helpers";

// ==========================================
// 0. 組織・権限・セキュリティ・共通基盤
// ==========================================

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  employeeNumber: text("employee_number").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  slackUserId: text("slack_user_id"), // Item0: SlackメンバーID。BotがこのIDへDM送信する(channel指定にuser IDをそのまま使える)。未設定ならemailのみ通知
  notificationChannel: text("notification_channel").notNull().default("email"), // Item0: 通知方法('email'|'slack')。プロフィール画面で本人が選択。slack選択でもslack_user_id未設定ならemailにフォールバック
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// BUG-022・BUG-024: ユーザーごとのログインの状態。行が無いユーザーは「失敗0回・ロックなし・取り消しなし」として扱う。
// ユーザーの物理削除(purgeUser)では、この行も一緒に消す(外部キーは付けない)
export const userLoginStates = sqliteTable("user_login_states", {
  userId: text("user_id").primaryKey(),
  // 続けてログインに失敗した回数(成功・ロックで0に戻す)
  failedCount: integer("failed_count").notNull().default(0),
  lastFailedAt: integer("last_failed_at", { mode: "timestamp" }),
  // 一時的なロックの期限(無効化できない初期のシステム管理者だけに使う)
  lockedUntil: integer("locked_until", { mode: "timestamp" }),
  // この時刻より前に発行したログイン(セッション)は無効(無効化・パスワード変更・ログアウトで更新する)
  sessionsValidAfter: integer("sessions_valid_after", { mode: "timestamp" }),
});

export const departments = sqliteTable("departments", {
  surrogateId: text("surrogate_id").primaryKey(),
  id: text("id").notNull(),
  name: text("name").notNull(),
  parentDepartmentSurrogateId: text(
    "parent_department_surrogate_id",
  ).references((): AnySQLiteColumn => departments.surrogateId),
  memo: text("memo"),
  validFrom: integer("valid_from", { mode: "timestamp" }).notNull(),
  validTo: integer("valid_to", { mode: "timestamp" }),
  ...withAuditColumns(),
});

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    departmentSurrogateId: text("department_surrogate_id").references(
      () => departments.surrogateId,
    ),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.roleId, table.departmentSurrogateId],
    }),
  ],
);

export const permissions = sqliteTable("permissions", {
  id: text("id").primaryKey(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  name: text("name").notNull(),
  description: text("description"),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

// ==========================================
// 2. マスタ系（取引先・商品・倉庫・ロケーション・勘定）
// ==========================================

export const units = sqliteTable("units", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("temporary"),
  ...withAuditColumns(),
});

export const unitConversions = sqliteTable("unit_conversions", {
  id: text("id").primaryKey(),
  fromUnitCode: text("from_unit_code")
    .notNull()
    .references(() => units.code),
  toUnitCode: text("to_unit_code")
    .notNull()
    .references(() => units.code),
  conversionFactor: real("conversion_factor").notNull(),
  ...withAuditColumns(),
});

// 取引先テーブル: customers -> partners に変更
export const partners = sqliteTable("partners", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("CUSTOMER"),
  postalCode: text("postal_code"),
  address: text("address"),
  phone: text("phone"),
  fax: text("fax"),
  creditLimit: integer("credit_limit").notNull().default(0),
  closingDay: integer("closing_day"),
  paymentMonthOffset: integer("payment_month_offset"),
  paymentDay: integer("payment_day"),
  paymentMethod: text("payment_method"),
  // 追加要望L-4-a: 適格請求書発行事業者の登録番号(T+13桁)と法人番号(13桁)。いずれも任意
  qualifiedInvoiceNumber: text("qualified_invoice_number"),
  corporateNumber: text("corporate_number"),
  antiSocialCheckStatus: text("anti_social_check_status").default("UNCHECKED"),
  antiSocialCheckMemo: text("anti_social_check_memo"),
  contractDate: integer("contract_date", { mode: "timestamp" }),
  contractValidTo: integer("contract_valid_to", { mode: "timestamp" }),
  status: text("status").notNull().default("temporary"),
  memo: text("memo"),
  ...withAuditColumns(),
});

// 添付ファイル: customer_attachments -> partner_attachments に変更
export const partnerAttachments = sqliteTable("partner_attachments", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  attachmentR2Path: text("attachment_r2_path"),
  externalUrl: text("external_url"),
  fileType: text("file_type").notNull().default("OTHER"),
  uploadedById: text("uploaded_by_id").notNull(),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

// ファームバンキング: 取引先の振込先口座(全銀協会「総合振込」フォーマットの被仕向側レコードに
// 必要な項目をそのまま保持する)。1取引先が複数口座を持てるよう別テーブルにする(ユーザー確認済み)。
// 独自の承認ワークフローは持たず、partners本体の更新承認フロー(既存)で保護する
export const partnerBankAccounts = sqliteTable("partner_bank_accounts", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id, { onDelete: "cascade" }),
  bankName: text("bank_name").notNull(),
  bankCode: text("bank_code"), // 全銀業界標準の金融機関コード(4桁)。手入力運用も想定しnullable
  branchName: text("branch_name").notNull(),
  branchCode: text("branch_code"), // 3桁
  // ORDINARY(普通)|CURRENT(当座)。全銀フォーマットの預金種目コード(1=普通/2=当座)への変換は
  // ファイル生成時に行う
  accountType: text("account_type").notNull().default("ORDINARY"),
  accountNumber: text("account_number").notNull(),
  // 受取人名(カナ)。全銀フォーマットは半角カナ30文字以内だが、桁数チェックはファイル生成時に行う
  accountHolderName: text("account_holder_name").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  memo: text("memo"),
  ...withAuditColumns(),
});

// 連絡先: customer_contacts -> partner_contacts に変更
export const partnerContacts = sqliteTable("partner_contacts", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id")
    .notNull()
    .references(() => partners.id),
  contactType: text("contact_type").notNull(),
  internalUserId: text("internal_user_id").references(() => users.id),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  fax: text("fax"),
  departmentName: text("department_name"),
  isEmailTarget: integer("is_email_target", { mode: "boolean" })
    .notNull()
    .default(true),
  memo: text("memo"),
  status: text("status").notNull().default("temporary"),
  ...withAuditColumns(),
});

// 新規要望(2026-09-23): 取引先ごとの複数納品先(受注の納品先選択で使う)。partnerContactsと同じ形
// (取引先ID+名称+郵便番号・住所・電話等+状態)だが、承認ワークフローは持たない
// (warehouseContactsと同じ判断: 納品先の追加・変更に承認は不要)
export const partnerDeliveryDestinations = sqliteTable(
  "partner_delivery_destinations",
  {
    id: text("id").primaryKey(),
    partnerId: text("partner_id")
      .notNull()
      .references(() => partners.id),
    name: text("name").notNull(),
    postalCode: text("postal_code"),
    address: text("address"),
    phone: text("phone"),
    memo: text("memo"),
    status: text("status").notNull().default("active"),
    ...withAuditColumns(),
  },
);

// 取引先担当者ごとの「メールで送る帳票」(V-5)。行がある帳票だけをその担当者へ送る(1つも無ければ送らない)。
// 帳票種別のキーはconstants/contact-document-types.tsで一元管理する(DB側にCHECK制約は設けない既存規約)。
// isEmailTarget(システム通知の対象)とは別の設定で、帳票の宛先にはこのテーブルだけを使う
export const partnerContactDocumentTypes = sqliteTable(
  "partner_contact_document_types",
  {
    contactId: text("contact_id")
      .notNull()
      .references(() => partnerContacts.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
  },
  (table) => [primaryKey({ columns: [table.contactId, table.documentType] })],
);

export const accounts = sqliteTable("accounts", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  externalMappingCode: text("external_mapping_code"),
  status: text("status").notNull().default("temporary"),
  memo: text("memo"),
  ...withAuditColumns(),
});

// プロジェクトマスタ(追加要望J-2-e、2026-09-13ユーザー確認済み): 購買申請・発注の「勘定科目」欄を
// 置き換えるための業務マスタ。承認ワークフロー(temporary仮登録)は要望に含まれていないため、
// active/suspendedの2状態のみとする(無効化しないと削除できない、他の非承認系マスタと同じ運用)
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), // PJコード
  name: text("name").notNull(), // プロジェクト名称
  memo: text("memo"),
  startDate: integer("start_date", { mode: "timestamp" }),
  endDate: integer("end_date", { mode: "timestamp" }),
  status: text("status").notNull().default("active"),
  ...withAuditColumns(),
});

// 仕訳ルールマスタ: 前払・仕入計上・前受・売上計上・入金・支払の6会計事象(src/db/journal-schema.tsの
// journal_batches.eventTypeと対応)ごとに、どの勘定科目で仕訳を起こすかを設定する。
// eventTypeが固定のためPKにし、行の削除は行わない(画面からの保存でUPSERTされる)。
// 入金(RECEIPT)は現金預金(借方)/売掛金(貸方)、支払(DISBURSEMENT)は買掛金(借方)/現金預金(貸方)。
// 既存の列だけで足りるため、種別の追加でテーブル構造は変わらない(text列のenumは型だけでCHECK制約はない)。
// 2026-09-09ユーザー確定: 品目に連動する変動科目(仕入高/売上高)は、品目マスタ(items.accountCode)と
// 伝票ヘッダー(purchaseRequests.accountCode/orders.accountCode)のどちらを優先して解決するかを
// ここで選べるようにする(variableAccountPriority)。受注(sales_orders)にはヘッダー科目の概念自体が
// 無いため、SALES/ADVANCE_RECEIPTでHEADER_FIRSTを選んでも実質ITEM_MASTER_FIRSTと同じに振る舞う
export const journalPostingRules = sqliteTable("journal_posting_rules", {
  eventType: text("event_type", {
    enum: ["PREPAYMENT", "PURCHASE", "ADVANCE_RECEIPT", "SALES", "RECEIPT", "DISBURSEMENT"],
  }).primaryKey(),

  // 品目に連動する変動科目(仕入高/売上高)の優先順位。PURCHASE/SALESでのみ使う
  // (PREPAYMENT/ADVANCE_RECEIPTは品目非依存の一括仕訳のため常にvariableAccountFallbackCodeを使う)
  variableAccountPriority: text("variable_account_priority", {
    enum: ["ITEM_MASTER_FIRST", "HEADER_FIRST"],
  }).notNull().default("ITEM_MASTER_FIRST"),
  // 品目マスタ・伝票ヘッダーのどちらにも科目が無い行、またはPREPAYMENT/ADVANCE_RECEIPTで使う既定科目
  variableAccountFallbackCode: text("variable_account_fallback_code").references(() => accounts.code),

  prepaidAccountCode: text("prepaid_account_code").references(() => accounts.code), // 前渡金(PREPAYMENT借方/PURCHASE充当)
  advanceReceivedAccountCode: text("advance_received_account_code").references(() => accounts.code), // 前受金(ADVANCE_RECEIPT貸方/SALES充当)
  cashAccountCode: text("cash_account_code").references(() => accounts.code), // 現金預金(PREPAYMENT貸方/ADVANCE_RECEIPT借方)
  payableAccountCode: text("payable_account_code").references(() => accounts.code), // 買掛金(PURCHASE貸方)
  receivableAccountCode: text("receivable_account_code").references(() => accounts.code), // 売掛金(SALES借方)
  taxAccountCode: text("tax_account_code").references(() => accounts.code), // 仮払消費税(PURCHASE)/仮受消費税(SALES)

  // 未設定のまま自動転記が走らないようにするための明示的な有効化フラグ(既定false)。
  // 全ての必須科目が埋まっていてもこれがfalseなら転記サービスはスキップする
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  memo: text("memo"),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// 仕訳パターン(V-5): 仕訳を「借方〇〇/貸方〇〇」の組で作るための、組ごとの借方・貸方の科目。
// 1行 = 会計事象×伝票区分×行の種類(本体/消費税/前受・前渡の充当)。どの行があるかは
// platform/journal/posting-patterns.ts の POSTING_PATTERN_SLOTS で固定する。
// 行が無い組は、journal_posting_rules の役割別の科目(売掛金・仮受消費税など)から組み立てる
// (V-5より前に設定したルールを、そのまま使い続けられるようにするため)。
// 有効/無効・品目科目の優先順位は、これまでどおり journal_posting_rules に持つ
export const journalPostingPatterns = sqliteTable(
  "journal_posting_patterns",
  {
    eventType: text("event_type", {
      enum: ["PREPAYMENT", "PURCHASE", "ADVANCE_RECEIPT", "SALES", "RECEIPT", "DISBURSEMENT"],
    }).notNull(),
    // 売上: SALE/RETURN/DISCOUNT/CORRECTION、仕入: PURCHASE/RETURN/DISCOUNT/CORRECTION、それ以外: DEFAULT
    documentType: text("document_type").notNull(),
    // BODY=本体(明細の税抜金額)、TAX=消費税、ADVANCE=前受金・前渡金の充当
    lineKind: text("line_kind", { enum: ["BODY", "TAX", "ADVANCE"] }).notNull(),
    // true の場合は品目マスタ(明細)の科目を使い、無い場合に debitAccountCode を使う
    debitFromItem: integer("debit_from_item", { mode: "boolean" }).notNull().default(false),
    debitAccountCode: text("debit_account_code").references(() => accounts.code),
    // true の場合は品目マスタ(明細)の科目を使い、無い場合に creditAccountCode を使う
    creditFromItem: integer("credit_from_item", { mode: "boolean" }).notNull().default(false),
    creditAccountCode: text("credit_account_code").references(() => accounts.code),
    updatedBy: text("updated_by"),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [primaryKey({ columns: [table.eventType, table.documentType, table.lineKind] })],
);

// ▼ 新規追加: 消費税区分マスタ
export const taxCategories = sqliteTable("tax_categories", {
  code: text("code").primaryKey(), // 例: "TAX_EXEMPT", "TAX_10", "TAX_8_REDUCED", "TAX_VARIABLE"
  name: text("name").notNull(), // 表示名（例: "10%標準税率", "8%軽減税率", "非課税", "可変/任意"）
  taxType: text("tax_type", {
    enum: ["EXEMPT", "STANDARD", "VARIABLE"],
  }).notNull(), // 種別
  taxRate: real("tax_rate").notNull().default(0), // 税率（例: 0.10, 0.08, 0.00）
  validFrom: integer("valid_from", { mode: "timestamp" }), // 適用開始日（税改正対応）
  validTo: integer("valid_to", { mode: "timestamp" }), // 適用終了日
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isPurchased: integer("is_purchased", { mode: "boolean" })
    .notNull()
    .default(false),
  isSales: integer("is_sales", { mode: "boolean" }).notNull().default(false),
  isService: integer("is_service", { mode: "boolean" })
    .notNull()
    .default(false),
  baseUnitCode: text("base_unit_code")
    .notNull()
    .references(() => units.code),
  taxCategoryCode: text("tax_category_code").notNull().default("TAX_10"),
  productBarcode: text("product_barcode"),
  accountCode: text("account_code").references(() => accounts.code),
  originalPurchasedItemId: text("original_purchased_item_id"),
  supplierId: text("supplier_id").references(() => partners.id),
  supplierPartNumber: text("supplier_part_number"),
  status: text("status").notNull().default("temporary"),
  memo: text("memo"),
  ...withAuditColumns(),
});

export const itemAttachments = sqliteTable("item_attachments", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  attachmentR2Path: text("attachment_r2_path"),
  externalUrl: text("external_url"),
  fileType: text("file_type").notNull().default("OTHER"),
  uploadedById: text("uploaded_by_id").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

export const itemStructures = sqliteTable("item_structures", {
  id: text("id").primaryKey(),
  parentItemId: text("parent_item_id")
    .notNull()
    .references(() => items.id),
  childItemId: text("child_item_id")
    .notNull()
    .references(() => items.id),
  quantityRequired: real("quantity_required").notNull().default(1),
  revision: text("revision").notNull().default("1.0"),
  validFrom: integer("valid_from", { mode: "timestamp" }).notNull(),
  validTo: integer("valid_to", { mode: "timestamp" }),
  memo: text("memo"),
  status: text("status").notNull().default("temporary"),
  ...withAuditColumns(),
});

export const itemPrices = sqliteTable("item_prices", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  priceType: text("price_type").notNull(),
  partnerId: text("partner_id").references(() => partners.id), // カラム名および参照先を partnerId/partners に変更
  minQuantity: real("min_quantity").notNull().default(0),
  unitPrice: integer("unit_price").notNull(),
  unitCode: text("unit_code")
    .notNull()
    .references(() => units.code),
  status: text("status", { enum: ["temporary", "active", "suspended"] })
    .notNull()
    .default("temporary"),
  validFrom: integer("valid_from", { mode: "timestamp" }).notNull(),
  validTo: integer("valid_to", { mode: "timestamp" }),
  ...withAuditColumns(),
});

export const warehouses = sqliteTable("warehouses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  postalCode: text("postal_code"),
  address: text("address"),
  phoneNumber: text("phone_number"),
  faxNumber: text("fax_number"),
  email: text("email"),
  businessStartTime: text("business_start_time"),
  businessEndTime: text("business_end_time"),
  storageRestrictions: text("storage_restrictions"),
  // Item6: 自社倉庫/外部倉庫の区分。"INTERNAL"(自社)| "EXTERNAL"(外部)。既存倉庫は全て自社倉庫扱いとしてデフォルトINTERNAL
  warehouseType: text("warehouse_type").notNull().default("INTERNAL"),
  status: text("status").notNull().default("temporary"),
  memo: text("memo"),
  ...withAuditColumns(),
});

// 新規要望: 営業拠点マスタ(2026-09-23、warehousesより簡素な項目構成で新設。
// 発注/受注の納品場所選択で倉庫マスタと並んで選べる、住所を持つ拠点マスタ)
export const businessLocations = sqliteTable("business_locations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  postalCode: text("postal_code"),
  address: text("address"),
  phoneNumber: text("phone_number"),
  status: text("status").notNull().default("temporary"),
  memo: text("memo"),
  ...withAuditColumns(),
});

export const warehouseAvailableDays = sqliteTable("warehouse_available_days", {
  id: text("id").primaryKey(),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),
  availabledayOfWeek: text("available_day_of_week").notNull(),
  timeSlotMemo: text("time_slot_memo"),
  ...withAuditColumns(),
});

export const warehouseAttachments = sqliteTable("warehouse_attachments", {
  id: text("id").primaryKey(),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageType: text("storage_type").notNull().default("R2"),
  attachmentR2Path: text("attachment_r2_path"),
  externalUrl: text("external_url"),
  fileType: text("file_type").notNull().default("OTHER"),
  uploadedById: text("uploaded_by_id").notNull(), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

// Item6 Phase6-4: 出荷指示書/入荷指示書のOTPダウンロード宛先を複数登録できるようにする。
// partner_contacts(取引先の登録済み連絡先)と同型の構造(1倉庫:N連絡先)
export const warehouseContacts = sqliteTable("warehouse_contacts", {
  id: text("id").primaryKey(),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  isEmailTarget: integer("is_email_target", { mode: "boolean" })
    .notNull()
    .default(true),
  memo: text("memo"),
  status: text("status").notNull().default("temporary"),
  ...withAuditColumns(),
});

// 倉庫担当者ごとの「メールで送る帳票」(出荷指示書・入荷指示書)。partner_contact_document_typesと同じ考え方
export const warehouseContactDocumentTypes = sqliteTable(
  "warehouse_contact_document_types",
  {
    contactId: text("contact_id")
      .notNull()
      .references(() => warehouseContacts.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
  },
  (table) => [primaryKey({ columns: [table.contactId, table.documentType] })],
);

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  name: text("name").notNull(),
  memo: text("memo"),
  status: text("status").notNull().default("temporary"),
  ...withAuditColumns(),
});

// ==========================================
// 3. 在庫マスタ（現在高の保持）
// ==========================================

export const stocks = sqliteTable(
  "stocks",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id),
    lotNumber: text("lot_number").notNull().default("NONE"),
    accountCode: text("account_code")
      .notNull()
      .references(() => accounts.code),
    // Item6: 品質区分。"NORMAL"(良品) | "DAMAGED"(破損品) | "QUARANTINE"(検品待ち)。
    // 同一ロケーション内で品質区分別に残高を保持するため、業務キー(下記unique index)に含める
    qualityStatus: text("quality_status").notNull().default("NORMAL"),
    quantity: real("quantity").notNull().default(0),
    qrCodeKey: text("qr_code_key").unique(),
    memo: text("memo"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("stocks_uk").on(
      table.itemId,
      table.warehouseId,
      table.locationId,
      table.lotNumber,
      table.accountCode,
      table.qualityStatus,
    ),
  ],
);

// Item7: 受注確定(APPROVED)時の在庫引当(ハード引当)。品目単位の合計値のみ保持し、
// 倉庫・ロケーション・ロットは受注時点では未確定のため持たない(出荷時にstocks側で決まる)。
// 利用可能数量 = SUM(stocks.quantity WHERE itemId=X AND qualityStatus='NORMAL') - reservedQuantity
// itemIdはstockTransactions.itemId等と同様、あえてFK制約を付けない(DIRECT入力明細=itemsマスタに
// 存在しないitemIdを持つ行は呼び出し元でそもそも引当対象から除外するが、念のため防御的に外す)
export const itemStockReservations = sqliteTable("item_stock_reservations", {
  itemId: text("item_id").primaryKey(),
  reservedQuantity: real("reserved_quantity").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Item7残課題2-5(2026-08-27): 倉庫単位の受注在庫引当。上記itemStockReservationsは
// この機能のリリース前に承認済みだった受注(レガシー、品目単位・全倉庫合算)専用として温存し、
// 新規の受注はこちらの倉庫単位カウンタを使う(データ移行は行わない)。
// stocks(集計値)とstockTransactions(履歴)の既存の関係と同じ「カウンタ+ledger」パターンを踏襲し、
// warehouseStockReservationsが原子的な排他制御用の高速カウンタ、salesOrderItemReservations
// (schema-biz.ts)がどの受注明細がいくら引き当てたかのトレーサビリティ用ledgerを担う
export const warehouseStockReservations = sqliteTable(
  "warehouse_stock_reservations",
  {
    itemId: text("item_id").notNull(),
    warehouseId: text("warehouse_id").notNull(),
    reservedQuantity: real("reserved_quantity").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.warehouseId] }),
  ],
);

// Item9: 品目×倉庫単位の発注点/安全在庫しきい値(欠品自動提案②の基礎データ)。
// 管理画面からCRUDする設定マスタのため、warehouseStockReservations(内部カウンタ、複合PK)とは異なり
// id主キー+withAuditColumns()の通常のマスタと同じ形にする(編集履歴・無効化等の将来拡張がしやすいよう)。
// 利用可能在庫の算出は既存パターンを踏襲: SUM(stocks.quantity WHERE itemId・warehouseId一致
// AND qualityStatus='NORMAL') - warehouseStockReservations.reservedQuantity
export const itemReorderSettings = sqliteTable(
  "item_reorder_settings",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    reorderPoint: real("reorder_point").notNull().default(0),
    safetyStock: real("safety_stock").notNull().default(0),
    memo: text("memo"),
    ...withAuditColumns(),
  },
  (table) => [
    uniqueIndex("item_reorder_settings_uk").on(table.itemId, table.warehouseId),
  ],
);
