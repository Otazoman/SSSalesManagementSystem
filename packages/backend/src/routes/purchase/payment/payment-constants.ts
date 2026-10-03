// Item10 Phase5: screens.tsのresourceキー(purchase_payment)と一致させる(監査ログ・権限判定共通)
export const RESOURCE_KEY = "purchase_payment";

export const PAYMENT_MODES = ["PER_TRANSACTION", "PERIODIC"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_DISBURSEMENT_METHODS = ["BANK_TRANSFER", "CASH", "OTHER"] as const;
