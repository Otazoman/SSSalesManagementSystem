// K-2-b: 明細単位の勘定科目選択肢(master/products/_types/index.tsのAccountLookupと同型)
export interface AccountLookup {
  code: string;
  name: string;
}

export interface PurchaseRecognitionAttachment {
  id?: string;
  fileName: string;
  storageType: "R2" | "GOOGLE_DRIVE" | "EXTERNAL_LINK";
  attachmentR2Path?: string | null;
  externalUrl?: string | null;
  fileType?: string;
}

export interface PurchaseRecognitionItem {
  itemId: string;
  itemName?: string;
  inputType: "MASTER" | "DIRECT";
  quantity: number;
  unitPrice: number;
  memo?: string | null;
  unitCode?: string | null;
  taxCategoryCode?: string | null;
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode?: string | null;
  // Item10: 発注明細単位で仕入を起こす場合の参照(単独仕入/発注ヘッダー単位の場合はnull)
  sourceOrderItemId?: string | null;
}

export type PurchaseRecognitionDocumentType = "PURCHASE" | "RETURN" | "DISCOUNT" | "CORRECTION";

export interface PurchaseRecognitionRecord {
  id: string;
  title: string | null;
  partnerId: string;
  orderId?: string | null;
  recognitionDate: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PENDING_DELETION";
  documentType: PurchaseRecognitionDocumentType;
  originalRecognitionId?: string | null;
  totalAmount: number;
  taxAmount: number;
  memo: string | null;
  paymentStatus?: string;
  items?: PurchaseRecognitionItem[];
  attachments?: PurchaseRecognitionAttachment[];
  companyName?: string;
  companyDepartment?: string | null;
  companyAddress?: string;
  companyTel?: string;
  companyFax?: string;
  paymentTerms?: string;
  updatedBy?: string;
  purchasePersonEmployeeNumber?: string | null;
  inputPersonEmployeeNumber?: string | null;
  // 追加要望: プロジェクト。発注からそのまま引き継ぐ
  projectId?: string | null;
  // L-1-b: 対象検収(入庫)のid一覧。詳細取得(GET /:id)でのみ返る
  receiptIds?: string[];
}

export interface ProjectLookup {
  id: string;
  name: string;
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

// Item10: 「発注から選択」ピッカーが一覧表示する、発注明細ごとの仕入残数量情報
export interface OrderItemProgress {
  sourceOrderItemId: string;
  itemId: string | null;
  itemName: string | null;
  inputType: string | null;
  quantity: number;
  unitPrice: number;
  unitCode: string | null;
  taxCategoryCode: string | null;
  accountCode: string | null;
  basisQuantity: number;
  recognizedQuantity: number;
  remainingQuantity: number;
  basis: "RECEIVED" | "ORDERED";
}

export interface OrderSummary {
  id: string;
  title: string | null;
  partnerId: string;
  status: string;
  totalAmount: number;
  // 追加要望: プロジェクト。仕入計上へそのまま引き継ぐ
  projectId?: string | null;
}
