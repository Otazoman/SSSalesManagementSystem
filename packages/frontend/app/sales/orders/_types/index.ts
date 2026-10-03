// K-2-b: 明細単位の勘定科目選択肢(master/products/_types/index.tsのAccountLookupと同型)
export interface AccountLookup {
  code: string;
  name: string;
}

export interface ProjectLookup {
  id: string;
  name: string;
}

// 新規要望(2026-09-23): 取引先ごとの複数納品先(受注の納品先選択で使う)
export interface PartnerDeliveryDestinationLookup {
  id: string;
  partnerId: string;
  name: string;
  postalCode?: string | null;
  address?: string | null;
}

export interface OrderAttachment {
  id?: string;
  fileName: string;
  storageType: "R2" | "GOOGLE_DRIVE" | "EXTERNAL_LINK";
  attachmentR2Path?: string | null;
  externalUrl?: string | null;
  fileType?: string;
}

export interface OrderItem {
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
  // Item7: どの見積明細に由来するか(見積からの受注作成時のみ設定、表示用トレーサビリティのみ)
  sourceQuoteItemId?: string | null;
  // Item7残課題2-5: 倉庫×数量の内訳リクエスト(JSON文字列)。未指定なら引当実行時に自動でFIFO割当する
  warehouseAllocationRequest?: string | null;
  // Item7残課題2-5: 引当できなかった残数量(バックオーダー、サーバー側で計算・保存される読み取り専用値)
  backorderedQuantity?: number;
}

export interface WarehouseAllocationLine {
  warehouseId: string;
  quantity: number;
}

export interface WarehouseAvailability {
  warehouseId: string;
  warehouseName: string;
  available: number;
}

// Item7残課題6: 受注→出荷指示/出庫の消込連携。受注明細ごとの出荷済/残数量・倉庫別引当内訳
export interface ShipmentProgressWarehouseBreakdown {
  warehouseId: string;
  warehouseName: string;
  warehouseType: "INTERNAL" | "EXTERNAL";
  reservedQuantity: number;
}

export interface ShipmentProgressItem {
  salesOrderItemId: string;
  itemId: string | null;
  itemName: string | null;
  inputType: string | null;
  quantity: number;
  shippedQuantity: number;
  remainingQuantity: number;
  reservations: ShipmentProgressWarehouseBreakdown[];
}

// 受注一覧からの一括出荷指示/出庫作成プレビュー・実行結果の型
// (POST /api/sales-orders/bulk-shipment-plan, /api/sales-orders/bulk-shipment-execute)
export interface BulkPlanManualItem {
  salesOrderItemId: string;
  itemId: string | null;
  itemName: string | null;
  remainingQuantity: number;
  reason: "NO_LOCATION_CANDIDATE" | "AMBIGUOUS_LOCATION" | "INSUFFICIENT_STOCK";
  candidateCount: number;
}

export interface BulkPlanOrderInstruction {
  warehouseId: string;
  warehouseName: string;
  items: { salesOrderItemId: string; itemId: string; itemName: string | null; quantity: number }[];
}

export interface BulkPlanOrderShipment {
  items: {
    salesOrderItemId: string;
    itemId: string;
    itemName: string | null;
    locationId: string;
    lotNumber: string;
    qualityStatus: string;
    quantity: number;
  }[];
}

export interface BulkPlanOrderResult {
  orderId: string;
  partnerId: string;
  instruction: BulkPlanOrderInstruction | null;
  shipment: BulkPlanOrderShipment | null;
  manualItems: BulkPlanManualItem[];
  skipped: boolean;
  error: string | null;
}

export interface OrderRecord {
  id: string;
  title: string | null;
  partnerId: string;
  // Item7: どの見積由来か(スナップショット方式、数量消込はしない)
  sourceQuoteId?: string | null;
  orderDate: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PENDING_DELETION";
  totalAmount: number;
  taxAmount: number;
  memo: string | null;
  terms: string | null;
  items?: OrderItem[];
  attachments?: OrderAttachment[];
  companyName?: string;
  companyAddress?: string;
  companyDepartment?: string | null;
  companyTel?: string;
  companyFax?: string;
  deliveryDate?: string;
  deliveryPlace?: string;
  // 新規要望(2026-09-23): 取引先ごとの複数納品先からの選択(手入力deliveryPlaceと併用可)
  deliveryDestinationId?: string | null;
  paymentTerms?: string;
  updatedBy?: string;
  salesPersonEmployeeNumber?: string | null;
  // Item7残課題: 営業担当(見積から引き継ぐ)とは別に、実際にこの伝票を入力する担当者
  inputPersonEmployeeNumber?: string | null;
  // Item9: 前受の最小対応(発注のisPaid/paidAtと対称)
  isPrepaid?: boolean;
  prepaidAt?: string | null;
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

// Item7: 見積からの受注作成(QuotePickerModal)で使う、見積側の最小限の型
export interface SourceQuoteSummary {
  id: string;
  title: string | null;
  partnerId: string;
  status: string;
  totalAmount: number;
  // Item7残課題: 見積詳細取得後に営業担当引き継ぎ用としてセットする(一覧取得時点では未設定)
  salesPersonEmployeeNumber?: string | null;
  // 追加要望: 見積詳細取得後にプロジェクト引き継ぎ用としてセットする(一覧取得時点では未設定)
  projectId?: string | null;
}

export interface SourceQuoteItem {
  id: string;
  itemId: string | null;
  itemName: string | null;
  inputType?: string | null;
  quantity: number;
  unitPrice: number;
  costPrice?: number | null;
  memo?: string | null;
  unitCode?: string | null;
  taxCategoryCode?: string | null;
}

// Item7: 見積から受注フォームへ引き継ぐ初期値(この時点ではまだDBに書き込まない)
export interface OrderPrefillData {
  title: string | null;
  partnerId: string;
  sourceQuoteId: string;
  orderDate: string;
  items: OrderItem[];
  // Item7残課題: 営業担当は見積から引き継ぐ(入力担当者は引き継がず、ログインユーザーを既定値とする)
  salesPersonEmployeeNumber?: string | null;
  // 追加要望: プロジェクト。見積からそのまま引き継ぐ
  projectId?: string | null;
}
