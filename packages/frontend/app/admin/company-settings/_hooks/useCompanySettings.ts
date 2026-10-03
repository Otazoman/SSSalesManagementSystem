"use client";

import { useState, useEffect } from "react";
import { SystemSettings, UserProfile } from "../_types";

export function useCompanySettings() {
  const [settings, setSettings] = useState<SystemSettings>({
    company_name: "",
    site_url: "",
    company_zip: "",
    company_address: "",
    company_tel: "",
    company_fax: "",
    company_invoice_registration_no: "",
    is_audit_log_enabled: true,
    is_partner_approval_enabled: false,
    is_partner_contact_approval_enabled: false,
    is_product_approval_enabled: false,
    is_product_price_approval_enabled: false,
    is_item_structure_approval_enabled: false,
    is_unit_approval_enabled: false,
    is_account_approval_enabled: false,
    is_warehouse_approval_enabled: false,
    is_location_approval_enabled: false,
    is_business_location_approval_enabled: false,
    is_tax_category_approval_enabled: false,
    is_quote_approval_enabled: false,
    is_sales_order_approval_enabled: false,
    is_purchase_requisition_approval_enabled: false,
    is_purchase_order_approval_enabled: false,
    is_sales_approval_enabled: false,
    is_purchase_approval_enabled: false,
    is_sales_invoice_requires_shipment: false,
    is_purchase_recognition_requires_receipt: false,
    is_receiving_approval_enabled: false,
    is_shipping_approval_enabled: false,
    is_inventory_approval_enabled: false,
    is_shipping_instruction_approval_enabled: false,
    is_shipping_result_approval_enabled: false,
    is_receiving_instruction_approval_enabled: false,
    is_receiving_result_approval_enabled: false,
    is_disposal_approval_enabled: false,
    is_damage_approval_enabled: false,
    is_return_approval_enabled: false,
    is_pagination_enabled: false,
    tax_rounding_mode: "floor",
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
    smtp_host: "",
    smtp_port: "587",
    smtp_user: "",
    smtp_pass: "",
    smtp_from: "",
    slack_bot_token: "",
    mail_batch_size: "5",
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
  });

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 権限ステート
  const [hasMenuAccess, setHasMenuAccess] = useState(false);
  const [canRead, setCanRead] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  // メールテスト用
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testError, setTestError] = useState("");

  useEffect(() => {
    const initializePage = async () => {
      try {
        const [profileRes, settingsRes] = await Promise.all([
          fetch("/api/auth/profile", { credentials: "include" }),
          fetch("/api/company-settings", { credentials: "include" }),
        ]);

        if (!profileRes.ok || !settingsRes.ok) {
          throw new Error("必要なマスタデータの同期に失敗しました");
        }

        const userProfile: UserProfile = await profileRes.json();
        const currentSettings: SystemSettings = await settingsRes.json();
        setSettings(currentSettings);

        // 👑 権限判定ロジック
        if (userProfile.roleId === "admin") {
          setHasMenuAccess(true);
          setCanRead(true);
          setCanWrite(true);
        } else {
          const userPerms = userProfile.permissions || [];
          setHasMenuAccess(userPerms.includes("company_settings:menu"));
          setCanRead(userPerms.includes("company_settings:read"));

          const hasWriteToken =
            userPerms.includes("company_settings:create") ||
            userPerms.includes("company_settings:update");
          setCanWrite(hasWriteToken);
        }
      } catch (err) {
        console.error("初期化エラー:", err);
        setError("システム初期化中にエラーが発生しました");
      } finally {
        setLoading(false);
      }
    };

    void initializePage();
  }, []);

  const saveSettings = async () => {
    if (!canWrite) {
      setError("あなたにはこの設定を変更する権限(更新権限)がありません");
      return;
    }

    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/company-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "更新に失敗しました");

      setMessage("Cloudflare KVマスタ設定を上書き更新しました");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const sendTestEmail = async () => {
    if (!testEmail) return;

    setTestError("");
    setTestMessage("");
    setSendingTest(true);
    try {
      const res = await fetch("/api/company-settings/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail: testEmail, settings }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "送信に失敗しました");
      setTestMessage(data.message);
    } catch (err) {
      if (err instanceof Error) setTestError(err.message);
    } finally {
      setSendingTest(false);
    }
  };

  return {
    settings,
    setSettings,
    loading,
    submitting,
    message,
    error,
    hasMenuAccess,
    canRead,
    canWrite,
    testEmail,
    setTestEmail,
    sendingTest,
    testMessage,
    testError,
    setTestError,
    setTestMessage,
    saveSettings,
    sendTestEmail,
  };
}
