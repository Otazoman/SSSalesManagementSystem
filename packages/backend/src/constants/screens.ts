export interface ScreenDefinition {
  resource: string;
  name: string;
  category:
    | "apply_approve"
    | "daily_work"
    | "accounting"
    | "log"
    | "system_master"
    | "business_master";
  icon?: string;
  path?: string;
}

export const SCREEN_MASTER: ScreenDefinition[] = [
  // 1. 申請・承認
  {
    resource: "wf_tasks",
    name: "承認タスク管理(未処理・判定)",
    category: "apply_approve",
    icon: "✅",
    path: "/workflow/tasks", // 💡一般は自分の承認、管理者は全承認をここで絞り込み
  },
  {
    resource: "wf_histories",
    name: "申請履歴・進捗一覧",
    category: "apply_approve",
    icon: "📋",
    path: "/workflow/histories", // 💡一般は自分の申請、管理者は全申請をここで参照
  },
  // 2. 日常業務
  {
    resource: "progress_overview",
    name: "進捗確認(見積〜支払)",
    category: "daily_work",
    icon: "🧭",
    path: "/progress",
  },
  {
    resource: "sales_deals",
    name: "商談管理",
    category: "daily_work",
    icon: "🤝",
    path: "/sales/deals", // 💡見込み客への営業活動(面談者・メモ・次回タスク・添付・見積紐づけ)を記録
  },
  {
    resource: "sales_quotes",
    name: "見積管理",
    category: "daily_work",
    icon: "📄",
    path: "/sales/quotes", // 💡画面内から「メール送信」「承認申請」ボタンを配置
  },
  {
    resource: "sales_orders",
    name: "受注管理",
    category: "daily_work",
    icon: "🧾",
    path: "/sales/orders",
  },
  {
    resource: "sales_invoices",
    name: "売上管理",
    category: "daily_work",
    icon: "📈",
    path: "/sales/invoices",
  },
  {
    resource: "inventory_shipping",
    name: "出荷",
    category: "daily_work",
    icon: "📤",
    path: "/inventory/shipping",
  },
  {
    resource: "sales_billing",
    name: "請求管理",
    category: "daily_work",
    icon: "🧮",
    path: "/sales/billing",
  },
  {
    resource: "purchase_requisitions",
    name: "購買申請",
    category: "daily_work",
    icon: "📝",
    path: "/purchase/requisitions",
  },
  {
    resource: "purchase_orders",
    name: "発注管理",
    category: "daily_work",
    icon: "🛒",
    path: "/purchase/orders",
  },
  {
    resource: "inventory_receiving",
    name: "入荷",
    category: "daily_work",
    icon: "📥",
    path: "/inventory/receiving",
  },
  {
    resource: "purchase_receipts",
    name: "仕入管理",
    category: "daily_work",
    icon: "📦",
    path: "/purchase/receipts",
  },
  {
    resource: "purchase_payment",
    name: "支払管理",
    category: "daily_work",
    icon: "💳",
    path: "/purchase/payment",
  },
  {
    resource: "inventory_audit",
    name: "在庫・棚卸管理",
    category: "daily_work",
    icon: "📋",
    path: "/inventory/audit",
  },

  // 3. 経理・統制
  {
    resource: "accounting_journal",
    name: "仕訳データ出力",
    category: "accounting",
    icon: "💵",
    path: "/accounting/journal",
  },
  {
    resource: "accounting_journal_rules",
    name: "仕訳ルールマスタ",
    category: "accounting",
    icon: "⚙️",
    path: "/accounting/journal-rules",
  },
  {
    resource: "accounting_journal_export_format",
    name: "仕訳CSV出力フォーマット設定",
    category: "accounting",
    icon: "🧾",
    path: "/accounting/journal-export-format",
  },
  {
    resource: "accounting_journal_edit",
    name: "仕訳編集",
    category: "accounting",
    icon: "📝",
    path: "/accounting/journal-edit",
  },
  {
    resource: "audit_logs",
    name: "操作ログ",
    category: "log",
    icon: "🔬",
    path: "/admin/audit-logs",
  },
  {
    resource: "mail_delivery_logs",
    name: "メール送信履歴ログ",
    category: "log",
    icon: "✉️",
    path: "/admin/mail-logs",
  },
  {
    resource: "otp_download_logs",
    name: "OTPダウンロードログ",
    category: "log",
    icon: "🔐",
    path: "/admin/otp-logs",
  },

  // 4. 基本マスタ設定
  {
    resource: "company_settings",
    name: "会社・システム設定",
    category: "system_master",
    icon: "🏢",
    path: "/admin/company-settings",
  },
  {
    resource: "admin_mail_settings",
    name: "メール送信設定",
    category: "system_master",
    icon: "✉️",
    path: "/admin/mail-settings",
  },
  {
    resource: "admin_r2_explorer",
    name: "R2ファイル管理",
    category: "system_master",
    icon: "🗂️",
    path: "/admin/r2-explorer",
  },
  {
    resource: "admin_announcements",
    name: "システムからのお知らせ管理",
    category: "system_master",
    icon: "📢",
    path: "/admin/announcements",
  },
  {
    resource: "admin_progress_stage_owners",
    name: "進捗確認: 工程ごとの担当設定",
    category: "system_master",
    icon: "👥",
    path: "/admin/progress-stage-owners",
  },
  {
    resource: "admin_d1_explorer",
    name: "D1データ参照・編集",
    category: "system_master",
    icon: "🗄️",
    path: "/admin/d1-explorer",
  },
  {
    resource: "admin_users",
    name: "ユーザー管理",
    category: "system_master",
    icon: "👥",
    path: "/admin/users",
  },
  {
    resource: "admin_permissions",
    name: "画面・権限マスタ",
    category: "system_master",
    icon: "🔑",
    path: "/admin/permissions",
  },
  {
    resource: "admin_departments",
    name: "組織・部署マスタ",
    category: "system_master",
    icon: "⚙️",
    path: "/admin/departments",
  },
  {
    resource: "admin_roles",
    name: "役職・ロールマスタ",
    category: "system_master",
    icon: "🛡️",
    path: "/admin/roles",
  },
  {
    resource: "approval_flows",
    name: "承認フロー定義",
    category: "system_master",
    icon: "🔀",
    path: "/admin/approval-flows",
  },
  // 5. 業務マスタ設定
  {
    resource: "master_partners",
    name: "取引先マスタ",
    category: "business_master",
    icon: "🏢",
    path: "/master/partners",
  },
  {
    resource: "master_contacts",
    name: "取引先担当者マスタ",
    category: "business_master",
    icon: "📇",
    path: "/master/partner-contacts",
  },
  {
    resource: "master_products",
    name: "品目マスタ",
    category: "business_master",
    icon: "📦",
    path: "/master/products",
  },
  {
    resource: "master_prices",
    name: "品目単価マスタ",
    category: "business_master",
    icon: "🏷️",
    path: "/master/product-prices",
  },
  {
    resource: "master_structures",
    name: "品目構成マスタ",
    category: "business_master",
    icon: "⛓️",
    path: "/master/product-structures",
  },
  {
    resource: "master_units",
    name: "単位マスタ",
    category: "business_master",
    icon: "📐",
    path: "/master/units",
  },
  {
    resource: "master_accounts",
    name: "勘定科目マスタ",
    category: "business_master",
    icon: "📖",
    path: "/master/accounts",
  },
  {
    resource: "master_warehouses",
    name: "倉庫マスタ",
    category: "business_master",
    icon: "🏠",
    path: "/master/warehouses",
  },
  {
    resource: "master_locations",
    name: "ロケーションマスタ",
    category: "business_master",
    icon: "📍",
    path: "/master/locations",
  },
  {
    resource: "master_projects",
    name: "プロジェクトマスタ",
    category: "business_master",
    icon: "🗂️",
    path: "/master/projects",
  },
  {
    resource: "master_business_locations",
    name: "営業拠点マスタ",
    category: "business_master",
    icon: "📌",
    path: "/master/business-locations",
  },
  {
    resource: "admin_tax_categories",
    name: "消費税マスタ",
    category: "system_master",
    icon: "💰",
    path: "/admin/tax-categories",
  },
  {
    resource: "master_item_reorder_settings",
    name: "発注点/安全在庫マスタ",
    category: "business_master",
    icon: "📉",
    path: "/master/item-reorder-settings",
  },
];

/**
 * 💡 監査ログなどの翻訳用に、リソースキーから日本語名を一発で引ける辞書型を自動生成
 * 例: { "sales_invoices": "受注・売上管理", "admin_users": "ユーザー管理" }
 */
export const SCREEN_TRANSLATION: Record<string, string> = SCREEN_MASTER.reduce(
  (acc, screen) => {
    acc[screen.resource] = screen.name;
    return acc;
  },
  { auth: "システム認証・アクセスセキュリティ" } as Record<string, string>,
);
