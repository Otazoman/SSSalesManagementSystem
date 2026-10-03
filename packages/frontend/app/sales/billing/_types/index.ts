export type BillingMode = "PER_TRANSACTION" | "PERIODIC";
export type BillingStatus = "DRAFT" | "ISSUED";
export type ReconciliationStatus = "UNRECONCILED" | "PARTIALLY_RECONCILED" | "RECONCILED";
export type PaymentReceiptMethod = "BANK_TRANSFER" | "CASH" | "OTHER";

export interface BillingRecord {
  id: string;
  partnerId: string;
  title: string | null;
  billingDate: string;
  mode: BillingMode;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: BillingStatus;
  totalAmount: number;
  taxAmount: number;
  reconciledAmount: number;
  reconciliationStatus: ReconciliationStatus;
  invoicePdfR2Path?: string | null;
  memo?: string | null;
}

// K-4-2: 消込画面で展開表示する売上明細行(sales_invoice_itemsの一部)
export interface BillingInvoiceLineItem {
  id: string;
  salesInvoiceId: string;
  itemId: string | null;
  itemName: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  unitCode: string | null;
  taxCategoryCode: string | null;
}

export interface BillingItemDetail {
  id: string;
  billingHeaderId: string;
  salesInvoiceId: string | null;
  amount: number;
  taxAmount: number;
  sortOrder: number;
  // K-4-3: 完全手動入力行(salesInvoiceIdがnull)の場合はnull
  salesInvoice: {
    id: string;
    title: string | null;
    invoiceDate: string;
    totalAmount: number;
    taxAmount: number;
  } | null;
  // K-4-2: 対象売上の明細行一覧(展開表示用)。手動入力行では常に空配列
  invoiceItems: BillingInvoiceLineItem[];
  // K-4-3: 完全手動入力行の明細(salesInvoiceIdがnullの場合のみ設定)
  itemName?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  taxCategoryCode?: string | null;
}

export interface PaymentReceiptRecord {
  id: string;
  billingHeaderId: string;
  receivedDate: string;
  amount: number;
  method: PaymentReceiptMethod;
  memo?: string | null;
  reconciledById: string;
  reconciledAt: string;
}

export interface BillingDetail extends BillingRecord {
  items: BillingItemDetail[];
  paymentReceipts: PaymentReceiptRecord[];
}

export interface UnbilledSalesInvoice {
  id: string;
  title: string | null;
  partnerId: string;
  invoiceDate: string;
  status: string;
  billingStatus: string;
  totalAmount: number;
  taxAmount: number;
}

export interface PartnerMaster {
  id: string;
  name: string;
  type?: string;
}

// K-4-3: 完全手動入力の明細行で使う税区分マスタ(sales/invoices/_types/index.tsと同型)
export interface TaxCategoryLookup {
  code: string;
  name: string;
  taxType: "EXEMPT" | "STANDARD" | "VARIABLE";
  taxRate: number;
}
