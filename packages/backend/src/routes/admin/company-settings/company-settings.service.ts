import { Context } from "hono";
import { setCookie } from "hono/cookie";
import { CompanySettingsRepository } from "./company-settings.repository";
import { writeAuditLog } from "../../../utils/logger";
import { sendEmail } from "../../../utils/mailer";
import { Env } from "../../../types/env";
import { refreshSessionCookie } from "../../../platform/auth/get-session";
import {
  UpdateCompanySettingsInput,
  SendTestEmailInput,
} from "./company-settings.schema";

const RESOURCE_KEY = "company_settings";

const DEFAULT_SETTINGS: UpdateCompanySettingsInput = {
  company_name: "",
  site_url: "",
  company_zip: "",
  company_address: "",
  company_tel: "",
  company_fax: "",
  company_invoice_registration_no: "",
  is_audit_log_enabled: true,
  is_partner_approval_enabled: true,
  is_partner_contact_approval_enabled: true,
  is_product_approval_enabled: true,
  is_product_price_approval_enabled: true,
  is_item_structure_approval_enabled: true,
  is_unit_approval_enabled: true,
  is_account_approval_enabled: true,
  is_warehouse_approval_enabled: true,
  is_location_approval_enabled: true,
  is_business_location_approval_enabled: true,
  is_tax_category_approval_enabled: true,
  is_quote_approval_enabled: true,
  is_sales_order_approval_enabled: true,
  is_purchase_requisition_approval_enabled: true,
  is_purchase_order_approval_enabled: true,
  is_sales_approval_enabled: true,
  is_purchase_approval_enabled: true,
  is_sales_invoice_requires_shipment: false,
  is_purchase_recognition_requires_receipt: false,
  is_receiving_approval_enabled: true,
  is_shipping_approval_enabled: true,
  is_inventory_approval_enabled: true,
  is_shipping_instruction_approval_enabled: true,
  is_shipping_result_approval_enabled: true,
  is_receiving_instruction_approval_enabled: true,
  is_receiving_result_approval_enabled: true,
  is_disposal_approval_enabled: true,
  is_damage_approval_enabled: true,
  is_return_approval_enabled: true,
  is_pagination_enabled: false,
  tax_rounding_mode: "floor",
  smtp_host: "smtp.gmail.com",
  smtp_port: "465",
  smtp_user: "",
  smtp_pass: "",
  smtp_from: "",
  slack_bot_token: "",
  mail_batch_size: "5",
  is_otp_download_restricted_to_contacts: true,
  otp_digit_count: "4",
  otp_expiry_minutes: "10",
  otp_max_attempts: "5",
  login_max_failed_attempts: "5",
  password_min_length: "8",
  password_require_uppercase: false,
  password_require_lowercase: false,
  password_require_digit: false,
  password_require_symbol: false,
  document_number_formats: {},
  master_code_formats: {},
  fb_committer_code: "",
  fb_committer_name: "",
  fb_bank_code: "",
  fb_bank_name: "",
  fb_branch_code: "",
  fb_branch_name: "",
  fb_account_type: "ORDINARY",
  fb_account_number: "",
};

export class CompanySettingsService {
  private repo: CompanySettingsRepository;

  constructor(env: Env) {
    this.repo = new CompanySettingsRepository(env);
  }

  // 1. システム設定情報の取得
  async getSettings(): Promise<UpdateCompanySettingsInput> {
    const kvData = await this.repo.getConfig();
    if (!kvData) {
      return DEFAULT_SETTINGS;
    }

    const parsedData = JSON.parse(kvData);

    const isPartnerApproval =
      parsedData.is_partner_approval_enabled !== undefined
        ? parsedData.is_partner_approval_enabled
        : (parsedData.is_approval_enabled ?? true);

    // Item4-e: 旧is_document_approval_enabled(単一グローバルフラグ)を伝票種別ごとに置き換えた。
    // 既存KVデータに新フィールドが無い場合は、旧フラグ(さらに古いis_approval_enabled)から
    // 一括で引き継ぐことで、移行前の動作(全伝票一律で承認要否を判定)を保つ。
    const legacyDocumentApproval =
      parsedData.is_document_approval_enabled ??
      parsedData.is_approval_enabled ??
      true;
    const perDocumentApprovalFields = [
      "is_quote_approval_enabled",
      "is_sales_order_approval_enabled",
      "is_purchase_requisition_approval_enabled",
      "is_purchase_order_approval_enabled",
      "is_sales_approval_enabled",
      "is_purchase_approval_enabled",
      "is_receiving_approval_enabled",
      "is_shipping_approval_enabled",
      "is_inventory_approval_enabled",
    ] as const;
    const perDocumentApprovalDefaults = Object.fromEntries(
      perDocumentApprovalFields.map((field) => [
        field,
        parsedData[field] !== undefined
          ? parsedData[field]
          : legacyDocumentApproval,
      ]),
    );

    return {
      ...DEFAULT_SETTINGS,
      ...parsedData,
      is_partner_approval_enabled: isPartnerApproval,
      ...perDocumentApprovalDefaults,
    };
  }

  // 1-2. 画面(ブラウザ)へ返す設定。BUG-011: SMTP のパスワード・Slack の Bot トークンは返さず、
  // 設定済みかどうかだけを返す(画面では伏せ字でも、開発者ツールで値が読めてしまうため)
  async getSettingsForClient() {
    const settings = await this.getSettings();
    return {
      ...settings,
      smtp_pass: "",
      slack_bot_token: "",
      smtp_pass_configured: !!settings.smtp_pass,
      slack_bot_token_configured: !!settings.slack_bot_token,
    };
  }

  // 2. システム設定情報の保存・更新 & Cookieセット
  async updateSettings(
    c: Context<{ Bindings: Env }>,
    body: UpdateCompanySettingsInput,
  ) {
    const oldKvData = await this.repo.getConfig();
    const oldSnapshot = oldKvData ? JSON.parse(oldKvData) : DEFAULT_SETTINGS;

    const newSettings: UpdateCompanySettingsInput = {
      company_name: body.company_name.trim(),
      site_url: body.site_url.trim(),
      company_zip: body.company_zip.trim(),
      company_address: body.company_address,
      company_tel: body.company_tel,
      company_fax: body.company_fax.trim(),
      company_invoice_registration_no:
        body.company_invoice_registration_no.trim(),
      is_audit_log_enabled: body.is_audit_log_enabled,
      is_partner_approval_enabled: body.is_partner_approval_enabled,
      is_partner_contact_approval_enabled:
        body.is_partner_contact_approval_enabled,
      is_product_approval_enabled: body.is_product_approval_enabled,
      is_product_price_approval_enabled:
        body.is_product_price_approval_enabled,
      is_item_structure_approval_enabled:
        body.is_item_structure_approval_enabled,
      is_unit_approval_enabled: body.is_unit_approval_enabled,
      is_account_approval_enabled: body.is_account_approval_enabled,
      is_warehouse_approval_enabled: body.is_warehouse_approval_enabled,
      is_location_approval_enabled: body.is_location_approval_enabled,
      is_business_location_approval_enabled:
        body.is_business_location_approval_enabled,
      is_tax_category_approval_enabled:
        body.is_tax_category_approval_enabled,
      is_quote_approval_enabled: body.is_quote_approval_enabled,
      is_sales_order_approval_enabled: body.is_sales_order_approval_enabled,
      is_purchase_requisition_approval_enabled:
        body.is_purchase_requisition_approval_enabled,
      is_purchase_order_approval_enabled:
        body.is_purchase_order_approval_enabled,
      is_sales_approval_enabled: body.is_sales_approval_enabled,
      is_purchase_approval_enabled: body.is_purchase_approval_enabled,
      is_sales_invoice_requires_shipment: body.is_sales_invoice_requires_shipment,
      is_purchase_recognition_requires_receipt:
        body.is_purchase_recognition_requires_receipt,
      is_receiving_approval_enabled: body.is_receiving_approval_enabled,
      is_shipping_approval_enabled: body.is_shipping_approval_enabled,
      is_inventory_approval_enabled: body.is_inventory_approval_enabled,
      is_shipping_instruction_approval_enabled:
        body.is_shipping_instruction_approval_enabled,
      is_shipping_result_approval_enabled:
        body.is_shipping_result_approval_enabled,
      is_receiving_instruction_approval_enabled:
        body.is_receiving_instruction_approval_enabled,
      is_receiving_result_approval_enabled:
        body.is_receiving_result_approval_enabled,
      is_disposal_approval_enabled: body.is_disposal_approval_enabled,
      is_damage_approval_enabled: body.is_damage_approval_enabled,
      is_return_approval_enabled: body.is_return_approval_enabled,
      is_pagination_enabled: body.is_pagination_enabled,
      tax_rounding_mode: body.tax_rounding_mode,
      smtp_host: body.smtp_host.trim(),
      smtp_port: body.smtp_port.trim(),
      smtp_user: body.smtp_user.trim(),
      // BUG-011: 画面には今の値を返さないため、空欄のまま保存された場合は今の値を残す
      smtp_pass: body.smtp_pass || oldSnapshot.smtp_pass || "",
      smtp_from: body.smtp_from.trim(),
      slack_bot_token: body.slack_bot_token || oldSnapshot.slack_bot_token || "",
      mail_batch_size: body.mail_batch_size.trim(),
      is_otp_download_restricted_to_contacts:
        body.is_otp_download_restricted_to_contacts,
      otp_digit_count: body.otp_digit_count.trim(),
      otp_expiry_minutes: body.otp_expiry_minutes.trim(),
      otp_max_attempts: body.otp_max_attempts.trim(),
      login_max_failed_attempts: body.login_max_failed_attempts,
      password_min_length: body.password_min_length,
      password_require_uppercase: body.password_require_uppercase,
      password_require_lowercase: body.password_require_lowercase,
      password_require_digit: body.password_require_digit,
      password_require_symbol: body.password_require_symbol,
      document_number_formats: body.document_number_formats,
      master_code_formats: body.master_code_formats,
      fb_committer_code: body.fb_committer_code.trim(),
      fb_committer_name: body.fb_committer_name.trim(),
      fb_bank_code: body.fb_bank_code.trim(),
      fb_bank_name: body.fb_bank_name.trim(),
      fb_branch_code: body.fb_branch_code.trim(),
      fb_branch_name: body.fb_branch_name.trim(),
      fb_account_type: body.fb_account_type,
      fb_account_number: body.fb_account_number.trim(),
    };

    await this.repo.saveConfig(JSON.stringify(newSettings));

    const maskedOldSnapshot = {
      ...oldSnapshot,
      smtp_pass: "********",
      slack_bot_token: "********",
    };
    const maskedNewSettings = {
      ...newSettings,
      smtp_pass: "********",
      slack_bot_token: "********",
    };

    await writeAuditLog(
      c,
      "UPDATE_KV_SYSTEM_SETTINGS",
      RESOURCE_KEY,
      "GLOBAL_CONFIG",
      maskedOldSnapshot,
      maskedNewSettings,
      true,
    );

    const maxAgeSeconds = 60 * 60 * 24; // 1日

    // 操作中の管理者自身のセッションcookieに、変更後の会社名・監査ログ有効設定を即時反映する
    // (再ログインなしで以後のリクエストに反映されるようにするため)。未ログイン状態なら何もしない。
    await refreshSessionCookie(c, {
      companyName: newSettings.company_name,
      isAuditEnabled: newSettings.is_audit_log_enabled,
    });

    setCookie(
      c,
      "login_user_master_approval_enabled",
      newSettings.is_partner_approval_enabled ? "true" : "false",
      { maxAge: maxAgeSeconds, path: "/", secure: true, sameSite: "Lax" },
    );

    setCookie(
      c,
      "login_user_quote_approval_enabled",
      newSettings.is_quote_approval_enabled ? "true" : "false",
      { maxAge: maxAgeSeconds, path: "/", secure: true, sameSite: "Lax" },
    );

    return {
      success: true,
      message: "Cloudflare KVにシステム設定を同期・保存しました",
    };
  }

  // 3. テストメール送信機能
  async sendTestEmail(c: Context<{ Bindings: Env }>, body: SendTestEmailInput) {
    const { toEmail, settings } = body;

    const companyName = settings.company_name || "システム共通";
    const siteUrl = settings.site_url || "(サイトURL未設定)";

    const mailSubject = `【テスト】${companyName} メール送信システム疎通確認`;

    const mailBody = [
      `※このメールはシステム共通マスタ設定より自動送信された接続テストメールです。`,
      ``,
      `販売管理システムのメール送信基盤(Gmail SMTPリレー)は正常に稼働しています。`,
      ``,
      `--------------------------------------------------`,
      `■ システム設定情報`,
      `--------------------------------------------------`,
      `公式会社名称: ${companyName}`,
      `システム本番環境URL: ${siteUrl}`,
      `送信元メールアドレス: ${settings.smtp_from || settings.smtp_user}`,
      `--------------------------------------------------`,
    ].join("\n");

    await sendEmail({
      smtpHost: settings.smtp_host,
      smtpPort: settings.smtp_port,
      smtpUser: settings.smtp_user,
      // BUG-011: パスワード欄が空欄(=変更なし)なら、保存済みのパスワードで送る
      smtpPass: settings.smtp_pass || (await this.getSettings()).smtp_pass,
      smtpFrom: settings.smtp_from,
      to: toEmail,
      subject: mailSubject,
      text: mailBody,
    });

    const isAuditEnabled = settings.is_audit_log_enabled !== false;
    await writeAuditLog(
      c,
      "EXECUTE_SMTP_TEST_EMAIL",
      RESOURCE_KEY,
      "SMTP_CONNECTION_TEST",
      null,
      {
        recipient: toEmail,
        smtpHost: settings.smtp_host,
        smtpPort: settings.smtp_port,
        smtpFrom: settings.smtp_from || settings.smtp_user,
      },
      isAuditEnabled,
    );

    return {
      success: true,
      message: "テストメールを正常に送信しました。受信トレイをご確認ください。",
    };
  }
}
