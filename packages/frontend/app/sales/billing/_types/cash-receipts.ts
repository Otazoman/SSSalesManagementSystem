// 追加要望L-1-a: 単体入金(請求を介さない入金。後から請求へ紐づけて消込する)
export interface CashReceipt {
  id: string;
  partnerId: string;
  receiptDate: string;
  amount: number;
  method: "BANK_TRANSFER" | "CASH" | "OTHER";
  memo: string | null;
  status: "UNLINKED" | "LINKED";
  billingHeaderId: string | null;
  linkedAt: string | null;
}

export interface PartnerLookup {
  id: string;
  name: string;
}

export interface BillingCandidate {
  id: string;
  partnerId: string;
  billingDate: string;
  totalAmount: number;
  reconciledAmount: number;
  reconciliationStatus: string;
}

export const METHOD_LABELS: Record<CashReceipt["method"], string> = {
  BANK_TRANSFER: "銀行振込",
  CASH: "現金",
  OTHER: "その他",
};

export interface CashReceiptFilters {
  partnerId: string;
  status: "all" | "UNLINKED" | "LINKED";
  startDate: string;
  endDate: string;
}
