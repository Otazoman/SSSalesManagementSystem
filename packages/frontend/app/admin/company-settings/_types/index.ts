import type { TaxRoundingMode } from "../../../_shared/tax-amounts";

export interface SystemSettings {
  company_name: string;
  site_url: string;
  company_zip?: string;
  company_address: string;
  company_tel: string;
  company_fax?: string;
  company_invoice_registration_no?: string;
  is_audit_log_enabled: boolean;
  is_partner_approval_enabled: boolean; // ★取引先マスタ承認フラグ(実際に機能する。旧is_master_approval_enabledから改名)
  // Item4-e: マスタ単位の承認フラグ(取引先=is_partner_approval_enabledは既存のまま、他9マスタ分を追加)。
  // 現時点で実際に機能するのは取引先のみ(他9項目は画面のみ整備、詳細実装は後日)。
  is_partner_contact_approval_enabled: boolean;
  is_product_approval_enabled: boolean;
  is_product_price_approval_enabled: boolean;
  is_item_structure_approval_enabled: boolean;
  is_unit_approval_enabled: boolean;
  is_account_approval_enabled: boolean;
  is_warehouse_approval_enabled: boolean;
  is_location_approval_enabled: boolean;
  // 新規要望: 営業拠点マスタ(2026-09-23新設)
  is_business_location_approval_enabled: boolean;
  is_tax_category_approval_enabled: boolean;
  // Item4-e: 伝票単位の承認フラグ(旧is_document_approval_enabledという単一グローバルフラグを置き換え)。
  // 現時点で実際に機能を持つのはis_quote_approval_enabledのみ(他7つは将来のItem7-10実装時に使用)。
  is_quote_approval_enabled: boolean;
  is_sales_order_approval_enabled: boolean;
  is_purchase_requisition_approval_enabled: boolean;
  is_purchase_order_approval_enabled: boolean;
  is_sales_approval_enabled: boolean;
  is_purchase_approval_enabled: boolean;
  is_sales_invoice_requires_shipment: boolean;
  is_purchase_recognition_requires_receipt: boolean;
  is_receiving_approval_enabled: boolean;
  is_shipping_approval_enabled: boolean;
  is_inventory_approval_enabled: boolean;
  // Item6: 在庫マスタ(外部倉庫の指示発行/実績反映、廃棄決定)。今回は画面のみ整備、判定ロジックは後日実装。
  is_shipping_instruction_approval_enabled: boolean;
  is_shipping_result_approval_enabled: boolean;
  is_receiving_instruction_approval_enabled: boolean;
  is_receiving_result_approval_enabled: boolean;
  is_disposal_approval_enabled: boolean;
  is_damage_approval_enabled: boolean;
  is_return_approval_enabled: boolean;
  is_pagination_enabled: boolean; // ★一覧画面のページネーション有効化フラグ
  tax_rounding_mode?: TaxRoundingMode; // BUG-042: 消費税の端数処理
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  slack_bot_token: string;
  // BUG-011: 取得APIは秘密の値(smtp_pass・slack_bot_token)を空で返し、設定済みかどうかだけを返す
  smtp_pass_configured?: boolean;
  slack_bot_token_configured?: boolean;
  mail_batch_size: string;
  is_otp_download_restricted_to_contacts: boolean; // ★見積書OTPダウンロードの宛先制限フラグ
  otp_digit_count: string; // OTPコードの桁数
  otp_expiry_minutes: string; // OTPコードの有効期限(分)
  otp_max_attempts: string; // OTPコードの最大試行回数
  login_max_failed_attempts: string; // BUG-022: ログインの失敗回数の上限(続けて失敗したらロック。0は制限なし)
  // BUG-046: パスワードのルール(本人が設定する時に確かめる。管理者がユーザー管理で設定する時は確かめない)
  password_min_length?: string;
  password_require_uppercase?: boolean;
  password_require_lowercase?: boolean;
  password_require_digit?: boolean;
  password_require_symbol?: boolean;
  // 伝票番号フォーマット(伝票種別キー→設定)。未設定の種別はバックエンド側のデフォルトが使われる
  document_number_formats: Record<string, DocumentNumberFormat>;
  // マスタコードフォーマット(マスタ種別キー→設定)。document_number_formatsと同じ構造・同じ理由
  master_code_formats: Record<string, DocumentNumberFormat>;
  // ファームバンキング: 全銀「総合振込」フォーマットのヘッダーレコードに使う自社(委託者)情報。
  // 半角(数字・半角カナ)での入力が前提(ファイル生成時にそのままJIS X0201へエンコードするため)
  fb_committer_code: string;
  fb_committer_name: string;
  fb_bank_code: string;
  fb_bank_name: string;
  fb_branch_code: string;
  fb_branch_name: string;
  fb_account_type: "ORDINARY" | "CURRENT";
  fb_account_number: string;
}

export interface DocumentNumberFormat {
  usePrefix: boolean;
  prefix: string;
  digitCount: number;
}

export interface DocumentTypeDefinition {
  key: string;
  label: string;
  defaultPrefix: string;
}

// backend/src/platform/id/document-types.tsと同じ一覧(表示用にフロント側にも複製)
export const DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  { key: "quote", label: "見積", defaultPrefix: "QT" },
  { key: "sales_order", label: "受注", defaultPrefix: "SO" },
  { key: "purchase_requisition", label: "購買申請", defaultPrefix: "PR" },
  { key: "purchase_order", label: "発注", defaultPrefix: "PO" },
  { key: "shipment_instruction", label: "出荷指示書", defaultPrefix: "SI" },
  { key: "receipt_instruction", label: "入荷指示書", defaultPrefix: "RI" },
  { key: "shipment", label: "出庫(出荷実績含む)", defaultPrefix: "SH" },
  { key: "receipt", label: "入庫(入荷実績含む)", defaultPrefix: "RC" },
  { key: "audit", label: "棚卸", defaultPrefix: "TK" },
  { key: "disposal", label: "廃棄", defaultPrefix: "DP" },
  { key: "reclassification", label: "品質区分変更", defaultPrefix: "RQ" },
  { key: "return", label: "返品", defaultPrefix: "RT" },
  { key: "approval_request", label: "承認申請", defaultPrefix: "AP" },
  { key: "sales_invoice", label: "売上", defaultPrefix: "UR" },
  { key: "purchase_recognition", label: "仕入", defaultPrefix: "SR" },
  { key: "billing", label: "請求", defaultPrefix: "BL" },
  { key: "payment", label: "支払", defaultPrefix: "PM" },
  { key: "cash_receipt", label: "入金(単体入金)", defaultPrefix: "RV" },
  // 追加要望M-1: 商談管理(backend/src/platform/id/document-types.tsと同じ)
  { key: "deal", label: "商談", defaultPrefix: "DL" },
];

// backend/src/platform/id/master-types.tsと同じ一覧(表示用にフロント側にも複製)。
// 単位・勘定科目・税区分・部署・ロケーションは性質上ルール採番になじまないためユーザー確認のうえ対象外
export const MASTER_TYPES: DocumentTypeDefinition[] = [
  { key: "partners", label: "取引先", defaultPrefix: "PT" },
  { key: "partner_contacts", label: "取引先担当者", defaultPrefix: "PC" },
  { key: "products", label: "品目", defaultPrefix: "PRD" },
  { key: "warehouses", label: "倉庫", defaultPrefix: "WH" },
  { key: "projects", label: "プロジェクト", defaultPrefix: "PJ" },
  { key: "business_locations", label: "営業拠点", defaultPrefix: "BL" },
];

export interface UserProfile {
  id: string;
  name: string;
  roleId: string;
  deptName: string;
  companyName: string;
  permissions: string[];
}
