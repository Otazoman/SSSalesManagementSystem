export type PaymentMode = "PER_TRANSACTION" | "PERIODIC";
export type PaymentHeaderStatus = "DRAFT" | "ISSUED";
export type ReconciliationStatus = "UNRECONCILED" | "PARTIALLY_RECONCILED" | "RECONCILED";
export type PaymentDisbursementMethod = "BANK_TRANSFER" | "CASH" | "OTHER";

export interface PaymentRecord {
  id: string;
  partnerId: string;
  title: string | null;
  paymentDate: string;
  mode: PaymentMode;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: PaymentHeaderStatus;
  totalAmount: number;
  taxAmount: number;
  reconciledAmount: number;
  reconciliationStatus: ReconciliationStatus;
  memo?: string | null;
}

export interface PaymentItemDetail {
  id: string;
  paymentHeaderId: string;
  purchaseRecognitionId: string | null;
  // K-5-1: 検収記録経由(仕入計上を介さない)の場合に設定される
  itemReceiptId: string | null;
  // K-5-3: 完全手動入力行の品目名(purchaseRecognitionId/itemReceiptIdどちらもnullの場合のみ)
  itemName: string | null;
  amount: number;
  taxAmount: number;
  sortOrder: number;
  // K-5-3: 完全手動入力行はnull
  purchaseRecognition: {
    id: string;
    title: string | null;
    recognitionDate: string;
    totalAmount: number;
    taxAmount: number;
  } | null;
  // K-5-1: purchaseRecognitionId経由・完全手動入力行はnull
  itemReceipt: {
    id: string;
    partnerId: string | null;
    receivedDate: string;
    supplierInvoiceNumber: string | null;
  } | null;
  // K-5-2: purchaseRecognitionIdに紐づく発注が前払済み(isPaid=true)の場合のみ設定される
  // (それ以外の行はnull)。amount=0の理由をUI上で示すための参照情報
  advanceOrder: {
    id: string;
    isPaid: boolean;
    paidAt: string | null;
    totalAmount: number;
  } | null;
}

// K-5-1: 支払作成モーダル「検収から選択」タブの候補行
export interface CandidateItemReceipt {
  id: string;
  partnerId: string | null;
  receivedDate: string;
  supplierInvoiceNumber: string | null;
  // 発注紐付きで金額を自動計算できた場合のみ設定される
  computedAmount: number | null;
  computedTaxAmount: number | null;
  // trueの場合、発注に基づく単価情報がないためamount/taxAmountの直接入力が必要
  requiresManualAmount: boolean;
  // L-1-b: 同じ納品の仕入計上(検収との紐づけ)。支払済みなら二重支払の警告を表示する(選択自体は可能)
  linkedRecognitionIds?: string[];
  linkedRecognitionPaid?: boolean;
}

export interface PaymentDisbursementRecord {
  id: string;
  paymentHeaderId: string;
  paidDate: string;
  amount: number;
  method: PaymentDisbursementMethod;
  memo?: string | null;
  reconciledById: string;
  reconciledAt: string;
}

export interface PaymentDetail extends PaymentRecord {
  items: PaymentItemDetail[];
  disbursements: PaymentDisbursementRecord[];
}

// K-5-2: /api/purchase-payments/candidate-recognitions のレスポンス形(未払・承認済みのみを
// 返すため、statusやpaymentStatusは含まない)
export interface UnpaidPurchaseRecognition {
  id: string;
  title: string | null;
  partnerId: string;
  recognitionDate: string;
  // BUG-057: PURCHASE以外(RETURN/DISCOUNT/CORRECTION)は赤伝。選択合計から差し引く
  documentType?: string;
  totalAmount: number;
  taxAmount: number;
  // trueの場合、紐づく発注が前払済み(isPaid=true)のため選択すると金額¥0の支払明細になる
  isAdvancePrepaid: boolean;
  advanceOrderId: string | null;
  advancePaidAt: string | null;
  // L-1-b: 同じ納品の検収記録(仕入との紐づけ)。既に支払対象なら二重支払の警告を表示する(選択自体は可能)
  linkedReceiptIds?: string[];
  linkedReceiptPaid?: boolean;
}

export interface PartnerMaster {
  id: string;
  name: string;
  type?: string;
  // BUG-063: "suspended"(取引停止)は新規の選択肢に出さない
  status?: string;
}
