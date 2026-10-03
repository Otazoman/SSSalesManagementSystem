// Item8 Phase4: screens.tsのresourceキー(sales_billing)と一致させる(監査ログ・権限判定共通)
export const RESOURCE_KEY = "sales_billing";

export const BILLING_MODES = ["PER_TRANSACTION", "PERIODIC"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const PAYMENT_RECEIPT_METHODS = ["BANK_TRANSFER", "CASH", "OTHER"] as const;
