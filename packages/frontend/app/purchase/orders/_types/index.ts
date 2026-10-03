export type PurchaseOrderStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PENDING_DELETION";

// K-2-b: 明細単位の勘定科目選択肢(master/products/_types/index.tsのAccountLookupと同型)
export interface AccountLookup {
  code: string;
  name: string;
}

// Phase5: quote_attachments/purchase_request_attachmentsと同じR2/共有リンク(外部URL)両対応
export interface PurchaseOrderAttachment {
  id?: string;
  orderId?: string;
  fileName: string;
  storageType: "R2" | "GOOGLE_DRIVE";
  attachmentR2Path?: string | null;
  externalUrl?: string | null;
  fileType?: string | null;
  downloadUrl?: string | null;
}

export interface PurchaseOrderItemRecord {
  id?: string;
  itemId: string;
  // purchase_request_items/quote_itemsと同じマスタ選択/手入力両対応
  itemName?: string | null;
  inputType?: "MASTER" | "DIRECT";
  quantity: number;
  unitPrice: number;
  unitCode?: string | null;
  taxCategoryCode?: string | null;
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode?: string | null;
  sortOrder?: number;
  memo?: string | null;
  // どの購買申請明細に由来するか(購買申請から発注を起票した場合のみ設定、表示用トレーサビリティ)
  purchaseRequestItemId?: string | null;
  salesOrderItemId?: string | null;
}

export interface PurchaseOrderRecord {
  id: string;
  title: string | null;
  partnerId?: string | null;
  // どの購買申請から発注されたか(承認機能ON時は必須、購買申請の起票トリガー③再発注等でも使用)
  requestId?: string | null;
  orderDate: string;
  status: PurchaseOrderStatus;
  projectId?: string | null;
  totalAmount: number;
  taxAmount?: number | null;
  memo: string | null;
  companyName?: string | null;
  companyDepartment?: string | null;
  companyAddress?: string | null;
  companyTel?: string | null;
  companyFax?: string | null;
  deliveryDate?: string | null;
  deliveryPlace?: string | null;
  // 新規要望(2026-09-23): 納品場所の「拠点用」「倉庫用」選択(いずれか一方、手入力deliveryPlaceと併用可)
  deliveryLocationId?: string | null;
  deliveryWarehouseId?: string | null;
  paymentTerms?: string | null;
  purchasePersonEmployeeNumber?: string | null;
  inputPersonEmployeeNumber?: string | null;
  // Item9設計確定: 前払の最小対応(支払完了を先に記録するためのマーカーのみ)
  isPaid?: boolean;
  paidAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  items?: PurchaseOrderItemRecord[];
  attachments?: PurchaseOrderAttachment[];
}

export interface ItemMaster {
  id: string;
  name: string;
  baseUnitCode?: string | null;
  taxCategoryCode?: string | null;
}

export interface ProjectLookup {
  id: string;
  name: string;
}

// 新規要望(2026-09-23): 納品場所の「拠点用」「倉庫用」選択の候補一覧
export interface BusinessLocationLookup {
  id: string;
  name: string;
  postalCode?: string | null;
  address?: string | null;
}

export interface WarehouseLookup {
  id: string;
  name: string;
  postalCode?: string | null;
  address?: string | null;
}

export interface PartnerLookup {
  id: string;
  name: string;
  type?: string;
}

// J-2-a: 発注の個別メール送信を見積(useQuoteForm.tsのPartnerContactOption)と同じ仕様に揃えるための型
export interface PartnerContactOption {
  id: string;
  name: string;
  email?: string;
  department?: string;
  position?: string;
}

export interface UserOption {
  id: string;
  name: string;
  employeeNumber: string;
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

// 購買申請から発注を作成する際の選択元(PurchaseRequisitionPickerModal用)
export interface SourceRequisitionSummary {
  id: string;
  title: string;
  totalAmount: number;
  partnerId?: string | null;
  projectId?: string | null;
}

export interface SourceRequisitionItem {
  id: string;
  itemId: string | null;
  itemName: string | null;
  inputType: string | null;
  quantity: number;
  estimatedUnitPrice: number;
  unitCode: string | null;
  taxCategoryCode: string | null;
  memo?: string | null;
}

export interface PurchaseOrderPrefillData {
  title: string;
  partnerId: string | null | undefined;
  // 購買申請から作成する場合は購買申請ID。受注欠品から直接作成する場合(承認機能OFF時のみ)は
  // 経由する購買申請が無いためnull
  requestId: string | null;
  orderDate: string;
  items: PurchaseOrderItemRecord[];
  // 追加要望対応: 引き継ぎ元(購買申請・過去の発注)のプロジェクトを新規発注へ引き継ぐ
  projectId?: string | null;
}
