// K-2-b: 明細単位の勘定科目選択肢(master/products/_types/index.tsのAccountLookupと同型)
export interface AccountLookup {
  code: string;
  name: string;
}

export interface ProjectLookup {
  id: string;
  name: string;
}

export interface SalesInvoiceAttachment {
  id?: string;
  fileName: string;
  storageType: "R2" | "GOOGLE_DRIVE" | "EXTERNAL_LINK";
  attachmentR2Path?: string | null;
  externalUrl?: string | null;
  fileType?: string;
}

export interface SalesInvoiceItem {
  itemId: string;
  itemName?: string;
  inputType: "MASTER" | "DIRECT";
  quantity: number;
  unitPrice: number;
  costPrice?: number | null;
  memo?: string | null;
  unitCode?: string | null;
  taxCategoryCode?: string | null;
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode?: string | null;
  // Item8: 受注明細単位で売上を起こす場合の参照(単独売上/受注ヘッダー単位の場合はnull)
  sourceOrderItemId?: string | null;
}

export type SalesInvoiceDocumentType = "SALE" | "RETURN" | "DISCOUNT" | "CORRECTION";

export interface SalesInvoiceRecord {
  id: string;
  title: string | null;
  partnerId: string;
  salesOrderId?: string | null;
  invoiceDate: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PENDING_DELETION";
  documentType: SalesInvoiceDocumentType;
  originalInvoiceId?: string | null;
  totalAmount: number;
  taxAmount: number;
  memo: string | null;
  billingStatus?: string;
  items?: SalesInvoiceItem[];
  attachments?: SalesInvoiceAttachment[];
  companyName?: string;
  companyDepartment?: string | null;
  companyAddress?: string;
  companyTel?: string;
  companyFax?: string;
  paymentTerms?: string;
  updatedBy?: string;
  salesPersonEmployeeNumber?: string | null;
  inputPersonEmployeeNumber?: string | null;
  // 追加要望: プロジェクト。受注からそのまま引き継ぐ
  projectId?: string | null;
}

export interface PartnerMaster {
  id: string;
  name: string;
  type?: string;
  email?: string | null;
  address?: string | null;
}

export interface ProductMaster {
  id: string;
  name: string;
  price: number;
  baseUnitCode?: string;
  taxCategoryCode?: string;
}

export interface UnitLookup {
  code: string;
  name: string;
}

export interface TaxCategoryLookup {
  code: string;
  name: string;
  taxType: "EXEMPT" | "STANDARD" | "VARIABLE";
  taxRate: number;
}

export interface DepartmentMaster {
  id: string;
  code?: string;
  name: string;
}

export interface UserOption {
  id: string;
  name: string;
  employeeNumber: string;
  department?: string;
  departments?: string[];
  departmentId?: string;
  department_id?: string;
  relations?: { departmentId?: string; department_id?: string }[];
}

// Item8: 「受注から選択」ピッカーが一覧表示する、受注明細ごとの売上残数量情報
export interface SalesOrderItemProgress {
  salesOrderItemId: string;
  itemId: string | null;
  itemName: string | null;
  inputType: string | null;
  quantity: number;
  unitPrice: number;
  unitCode: string | null;
  taxCategoryCode: string | null;
  accountCode: string | null;
  basisQuantity: number;
  invoicedQuantity: number;
  remainingQuantity: number;
  basis: "SHIPPED" | "ORDERED";
}

export interface SalesOrderSummary {
  id: string;
  title: string | null;
  partnerId: string;
  status: string;
  totalAmount: number;
  // 追加要望: プロジェクト。売上計上へそのまま引き継ぐ
  projectId?: string | null;
}
