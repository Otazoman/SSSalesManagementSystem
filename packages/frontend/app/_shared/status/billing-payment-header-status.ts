import { StatusBadgeSpec } from "../ui/StatusBadge";

// J-2-c: 請求(billing_headers)・支払(payment_headers)のヘッダー状態(承認ワークフローを
// 持たないため、document-lifecycle-status.tsのDRAFT/PENDING_APPROVAL/APPROVED等とは
// 別の語彙。PDF発行の有無のみを表すシンプルな2状態。REQ-017: 請求は承認が ON の時、承認申請中・承認済みを挟む)
export const BILLING_PAYMENT_HEADER_STATUS: Record<string, StatusBadgeSpec> = {
  DRAFT: { label: "⚪ 下書き", tone: "slate" },
  ISSUED: { label: "🟢 発行済み", tone: "emerald" },
  // REQ-017: 請求の承認が ON の時だけ使う状態(支払には無い)
  PENDING_APPROVAL: { label: "🟡 承認申請中", tone: "amber" },
  APPROVED: { label: "🔵 承認済み(未発行)", tone: "sky" },
};

export function getBillingPaymentHeaderStatus(status: string): StatusBadgeSpec {
  return BILLING_PAYMENT_HEADER_STATUS[status] ?? { label: status, tone: "slate" };
}
