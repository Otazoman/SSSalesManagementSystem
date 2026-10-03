export interface QuoteAttachment {
  id?: string;
  fileName: string;
  storageType: "R2" | "GOOGLE_DRIVE" | "EXTERNAL_LINK";
  attachmentR2Path?: string | null;
  externalUrl?: string | null;
  fileType?: string;
}

export interface QuoteItem {
  // 保存済みの明細のID(新しく追加した明細には無い)。保存時に送り、明細IDを保ったまま更新する
  id?: string;
  itemId: string;
  itemName?: string;
  inputType: "MASTER" | "DIRECT";
  quantity: number;
  unitPrice: number;
  costPrice?: number | null;
  memo?: string | null;
  // Item4-b: 単位・税区分。商品選択時にitemsマスタから自動セットされるが、手動選択も可能
  unitCode?: string | null;
  taxCategoryCode?: string | null;
}

export interface QuoteRecord {
  id: string;
  title: string | null;
  customerId: string;
  quoteDate: string;
  validUntil: string | null;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PENDING_DELETION";
  totalAmount: number;
  taxAmount: number;
  memo: string | null;
  terms: string | null;
  items?: QuoteItem[];
  attachments?: QuoteAttachment[];
  version?: number;
  company_name?: string;
  companyName?: string;
  company_zip?: string;
  companyZip?: string;
  company_address?: string;
  companyAddress?: string;
  companyDepartment?: string | null;
  company_department?: string | null;
  company_tel?: string;
  companyTel?: string;
  company_fax?: string;
  companyFax?: string;
  delivery_date?: string;
  deliveryDate?: string;
  delivery_place?: string;
  deliveryPlace?: string;
  payment_terms?: string;
  paymentTerms?: string;
  updatedBy?: string;
  // Item4-d: 自社担当者(employeeNumber)。監査用のupdatedByとは別
  salesPersonEmployeeNumber?: string | null;
  // Item7残課題(見積へも展開): 営業担当とは別の、実際にこの伝票を入力する担当者
  inputPersonEmployeeNumber?: string | null;
  // 追加要望: プロジェクト。受注作成時にそのまま引き継ぐ
  projectId?: string | null;
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
  closingDay?: number | null;
  closing_day?: number | null;
  paymentMonthOffset?: number | null;
  payment_month_offset?: number | null;
  paymentDay?: number | null;
  payment_day?: number | null;
  paymentMethod?: string | null;
  payment_method?: string | null;
  address?: string | null;
}

export interface ProductMaster {
  id: string;
  name: string;
  price: number;
  baseUnitCode?: string;
  taxCategoryCode?: string;
}

// Item4-b: 単位・税区分のドロップダウン用ルックアップ(master/products/_types と同じ最小パターン)
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

// 💡【追加】部署マスタの型定義
export interface DepartmentMaster {
  id: string; // サロゲートID (UUIDや自動採番ID)
  code?: string; // 部署コード (例: DEPT-001)
  name: string; // 部署名 (例: 営業部)
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
