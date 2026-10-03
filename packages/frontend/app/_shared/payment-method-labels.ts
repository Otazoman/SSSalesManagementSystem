/**
 * 入金・支払方法のコードと表示名(#14-2③: BillingDetailModal.tsx・PaymentDetailModalで
 * 同じ定義が重複していたため1箇所にまとめる)。
 */
export const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "銀行振込",
  CASH: "現金",
  OTHER: "その他",
};
