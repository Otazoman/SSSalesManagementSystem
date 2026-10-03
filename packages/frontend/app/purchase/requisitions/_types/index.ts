export type PurchaseRequisitionStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PENDING_DELETION";

// Item9追加設計確定: 都度/定期/前払の3区分(2026-09-03、消耗品/製品部材の区別は明細のaccountCodeに
// 既に反映されているため廃止)
export type PurchaseRequisitionCategory = "ONE_TIME" | "PERIODIC" | "PREPAYMENT";

// K-2-b: 明細単位の勘定科目選択肢(master/products/_types/index.tsのAccountLookupと同型)
export interface AccountLookup {
  code: string;
  name: string;
}

// Phase3フォローアップ: quote_attachmentsと同じR2/共有リンク(外部URL)両対応
export interface PurchaseRequisitionAttachment {
  id?: string;
  requestId?: string;
  fileName: string;
  storageType: "R2" | "GOOGLE_DRIVE";
  attachmentR2Path?: string | null;
  externalUrl?: string | null;
  downloadUrl?: string | null;
}

export interface PurchaseRequisitionItemRecord {
  id?: string;
  itemId: string;
  // Phase3フォローアップ: quote_itemsと同じマスタ選択/手入力両対応
  itemName?: string | null;
  inputType?: "MASTER" | "DIRECT";
  quantity: number;
  estimatedUnitPrice: number;
  // Phase3フォローアップ: 見積との項目整合。勘定科目はヘッダーへ移動、単位/税区分/並べ替えを追加
  unitCode?: string | null;
  taxCategoryCode?: string | null;
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode?: string | null;
  sortOrder?: number;
  memo?: string | null;
  salesOrderItemId?: string | null;
}

export interface PurchaseRequisitionRecord {
  id: string;
  title: string;
  departmentSurrogateId: string;
  applicantId: string;
  // Phase3フォローアップ: 見積のinputPersonEmployeeNumberと同じ、申請者とは別の入力担当者
  inputPersonEmployeeNumber?: string | null;
  requestType: PurchaseRequisitionCategory;
  status: PurchaseRequisitionStatus;
  // Phase3フォローアップ: 仕入先(見積の得意先選択に相当)。品目と同じマスタ選択/手入力両対応
  partnerId?: string | null;
  partnerName?: string | null;
  partnerInputType?: "MASTER" | "DIRECT";
  // Phase3フォローアップ: 見積との項目整合。勘定科目はヘッダー1件につき1つ
  projectId?: string | null;
  totalAmount: number;
  taxAmount?: number | null;
  memo: string | null;
  createdAt?: string;
  updatedAt?: string;
  items?: PurchaseRequisitionItemRecord[];
  attachments?: PurchaseRequisitionAttachment[];
}

export interface ItemMaster {
  id: string;
  name: string;
  // Phase3フォローアップ: 品目マスタ選択時に単位/税区分を自動初期値として引くために使う
  // (見積のProductMaster.baseUnitCode/taxCategoryCodeと同じ、/api/productsのレスポンスに含まれる)
  baseUnitCode?: string | null;
  taxCategoryCode?: string | null;
}

export interface ProjectLookup {
  id: string;
  name: string;
}

export interface DepartmentOption {
  // surrogateId: purchase_requests.department_surrogate_id(FK先の実体)。idは表示用の業務コード
  surrogateId: string;
  id: string;
  name: string;
}

export interface PartnerLookup {
  id: string;
  name: string;
  type?: string;
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

// Phase4: 起票トリガー②(受注紐付け)。SalesOrderPickerModal用の選択元一覧・明細
export interface SourceSalesOrderSummary {
  id: string;
  title: string;
  partnerId?: string | null;
}

export interface SourceSalesOrderItem {
  id: string;
  itemId: string | null;
  itemName: string | null;
  inputType: string | null;
  quantity: number;
  unitPrice: number;
  unitCode: string | null;
  taxCategoryCode: string | null;
  backorderedQuantity: number;
  memo?: string | null;
  // Phase6: 欠品自動提案①(受注紐付け方式)。受注横断の集約モードでのみ設定される
  salesOrderId?: string;
  salesOrderTitle?: string | null;
}

// Phase4: 起票トリガー③(発注紐付けの再発注)。PurchaseOrderPickerModal用の選択元一覧・明細
export interface SourcePurchaseOrderSummary {
  id: string;
  title: string | null;
  totalAmount: number;
  partnerId?: string | null;
  projectId?: string | null;
}

export interface SourcePurchaseOrderItem {
  id: string;
  itemId: string | null;
  itemName: string | null;
  inputType: string | null;
  quantity: number;
  unitPrice: number;
  unitCode: string | null;
  taxCategoryCode: string | null;
  memo?: string | null;
}

// Phase7: 欠品自動提案②(発注点/安全在庫方式)。ReorderSuggestionPickerModal用の候補一覧
export interface ReorderSuggestionCandidate {
  id: string;
  itemId: string;
  itemName: string;
  baseUnitCode: string | null;
  taxCategoryCode: string | null;
  warehouseId: string;
  warehouseName: string;
  reorderPoint: number;
  safetyStock: number;
  currentStock: number;
  suggestedQuantity: number;
}

// Phase4: 起票トリガー②③・「コピーして下書き作成」共通のプレフィルデータ
// (この時点ではDBに一切書き込まない。フォームへ初期値を渡すのみ)
export interface PurchaseRequisitionPrefillData {
  title: string;
  partnerId?: string | null;
  partnerName?: string | null;
  partnerInputType?: "MASTER" | "DIRECT";
  projectId?: string | null;
  memo?: string | null;
  items: PurchaseRequisitionItemRecord[];
}
