import { StatusBadgeSpec } from "../ui/StatusBadge";

// J-2-c: 請求(billing_headers)・支払(payment_headers)のヘッダー状態(承認ワークフローを
// 持たないため、document-lifecycle-status.tsのDRAFT/PENDING_APPROVAL/APPROVED等とは
// 別の語彙。PDF発行の有無のみを表すシンプルな2状態)
export const BILLING_PAYMENT_HEADER_STATUS: Record<string, StatusBadgeSpec> = {
  DRAFT: { label: "⚪ 下書き", tone: "slate" },
  ISSUED: { label: "🟢 発行済み", tone: "emerald" },
};

export function getBillingPaymentHeaderStatus(status: string): StatusBadgeSpec {
  return BILLING_PAYMENT_HEADER_STATUS[status] ?? { label: status, tone: "slate" };
}
