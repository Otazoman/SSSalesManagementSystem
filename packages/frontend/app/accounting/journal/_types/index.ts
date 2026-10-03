export interface JournalPostingEventRecord {
  id: string;
  sourceType: string;
  sourceRefId: string;
  eventType: string;
  status: "PENDING" | "PROCESSING" | "POSTED" | "FAILED";
  postedBatchId: string | null;
  retryCount: number;
  errorMessage: string | null;
  requestedById: string;
  requestedAt: string;
  postedAt: string | null;
}

// 伝票を選んで仕訳を作る(V-4)。バックエンドのJOURNAL_SOURCE_KINDSと同じキー
export type JournalSourceKind =
  | "purchase_order"
  | "sales_order"
  | "cash_receipt"
  | "sales_invoice"
  | "purchase_recognition"
  | "payment_receipt"
  | "payment_disbursement";

export interface JournalSourceCandidate {
  kind: JournalSourceKind;
  kindLabel: string;
  sourceRefId: string;
  eventType: string;
  date: string;
  partnerId: string | null;
  partnerName: string | null;
  amount: number;
  description: string;
  // 売上・仕入のみ(SALE/RETURN/DISCOUNT/CORRECTION、PURCHASE/…)
  documentType?: string;
}

// 売上の前受金として充当できる単体入金
export interface AdvanceCandidate {
  cashReceiptId: string;
  receiptDate: string;
  amount: number;
  appliedAmount: number;
  remainingAmount: number;
  memo: string | null;
}

export interface JournalSourcePostResult {
  sourceRefId: string;
  ok: boolean;
  message: string;
}
