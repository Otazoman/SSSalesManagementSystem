export interface LocationRecord {
  id: string;
  warehouseId: string;
  name: string;
  status: string;
}

export interface WarehouseRecord {
  id: string;
  name: string;
  warehouseType: string;
  status: string;
}

// Item6 Phase6-4: 出荷指示・自社出庫の得意先/入荷指示の仕入先選択に使う(取引先マスタの部分集合)
export interface PartnerRecord {
  id: string;
  name: string;
  type: string;
}

export interface ProductRecord {
  id: string;
  name: string;
  productBarcode: string | null;
  accountCode: string | null;
  baseUnitCode: string;
  status: string;
}

export interface StockRecord {
  id: string;
  itemId: string;
  itemName: string | null;
  warehouseId: string;
  warehouseName: string | null;
  locationId: string;
  locationName: string | null;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  quantity: number;
  updatedAt: string;
}

export interface ReceiptLineDraft {
  key: string;
  itemId: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  locationId: string;
  locationName: string;
  lotNumber: string;
  quantity: number;
  // Item6 Phase6-3-2: 入庫時検品(破損・不良品管理)。PASSED=良品/DAMAGED=破損/QUARANTINE=検品待ち
  inspectionStatus: string;
  inspectionMemo: string;
  // Item9: 「発注から選ぶ」で紐付けた発注明細(任意)
  orderItemId?: string | null;
}

export interface ShipmentLineDraft {
  key: string;
  locationId: string;
  locationName: string;
  itemId: string;
  itemName: string;
  quantity: number;
  lotNumber?: string;
  qualityStatus?: string;
  // Item7残課題6: この明細がどの受注明細の消込対象かを示す(任意、受注に紐づかない出庫ではnull)
  salesOrderItemId?: string | null;
}

export interface ReceiptHeaderRecord {
  id: string;
  receivedDate: string;
  supplierInvoiceNumber: string | null;
  status: string;
  memo: string | null;
  createdBy: string;
  createdAt: string;
  // Item9: 仕入先(検収書発行のメール送信先解決に使用)
  partnerId: string | null;
  // Item9: 「発注から選ぶ」で紐付けた発注(任意)。検収書PDFの発注番号欄にも使用する
  orderId: string | null;
  // 新規要望(2026-09-23): 倉庫間移動の移動元倉庫(仕入先と排他、未設定の場合はnull)
  sourceWarehouseId: string | null;
}

export interface ReceiptItemRecord {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  receivedQuantity: number;
  accountCode: string;
  inspectionStatus: string;
  // Item9: どの発注明細に対する入荷かのトレーサビリティ(任意)
  orderItemId?: string | null;
}

export interface ShipmentHeaderRecord {
  id: string;
  shippedDate: string;
  status: string;
  memo: string | null;
  partnerId: string | null;
  createdBy: string;
  createdAt: string;
  // Item7残課題6: 受注から作成された場合のみ設定される(単独作成の場合はnull)
  salesOrderId: string | null;
  // 納品書発行タブ: 自動生成された納品書PDFのR2パス(未生成の場合はnull)
  deliveryNoteR2Path: string | null;
  // 新規要望(2026-09-23): 倉庫間移動の移動先倉庫(得意先と排他、未設定の場合はnull)
  destinationWarehouseId: string | null;
}

export interface ShipmentItemRecord {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  qualityStatus: string;
  shippedQuantity: number;
  accountCode: string;
}

// Item6 Phase6-3-2: 品質区分変更(破損・不良品管理)。targetTypeは入出庫と同じ"inventory_stock"を
// 共有するため、修正して再提出も/inventory/stockのeditId解決フローで扱う
export interface ReclassificationRecord {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  fromQualityStatus: string;
  toQualityStatus: string;
  quantity: number;
  status: string;
  memo: string | null;
  createdBy: string;
  createdAt: string;
}

// Item6 Phase6-3-3: 廃棄決定。targetTypeは入出庫と同じ"inventory_stock"を共有するため、
// 修正して再提出も/inventory/stockのeditId解決フローで扱う
export interface DisposalRecord {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  quantity: number;
  status: string;
  memo: string | null;
  createdBy: string;
  createdAt: string;
}

// Item6 Phase6-4: 出荷指示(外部倉庫向け)。targetTypeは入出庫と同じ"inventory_stock"を
// 共有するため、修正して再提出も/inventory/stockのeditId解決フローで扱う
export interface ShipmentInstructionHeaderRecord {
  id: string;
  partnerId: string;
  warehouseId: string;
  instructedShipDate: string;
  status: string;
  memo: string | null;
  instructionDocumentR2Path: string | null;
  createdBy: string;
  createdAt: string;
  // Item7残課題6: 受注から作成された場合のみ設定される(単独作成の場合はnull)
  salesOrderId: string | null;
}

export interface ShipmentInstructionItemRecord {
  id: string;
  itemId: string;
  lotNumber: string;
  instructedQuantity: number;
  accountCode: string;
  memo: string | null;
  // Item6 消込データ引渡し: 指示詳細取得時のみ付与される(品目×ロット単位の消込済み・残数量)
  fulfilledQuantity?: number;
  remainingQuantity?: number;
}

// Item6 Phase6-4: 入荷指示(外部倉庫向け)。出荷指示と対称構造
export interface ReceiptInstructionHeaderRecord {
  id: string;
  partnerId: string;
  warehouseId: string;
  instructedReceiveDate: string;
  status: string;
  memo: string | null;
  instructionDocumentR2Path: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ReceiptInstructionItemRecord {
  id: string;
  itemId: string;
  lotNumber: string;
  instructedQuantity: number;
  accountCode: string;
  memo: string | null;
  // Item6 消込データ引渡し: 指示詳細取得時のみ付与される(品目×ロット単位の消込済み・残数量)
  fulfilledQuantity?: number;
  remainingQuantity?: number;
}

// Item6 Phase6-3-3: 返品(仕入先へ返品/得意先から返品の両方向)。targetTypeは入出庫と同じ
// "inventory_stock"を共有するため、修正して再提出も/inventory/stockのeditId解決フローで扱う
export interface ReturnRecord {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  direction: "OUTBOUND" | "INBOUND";
  quantity: number;
  returnReason: string | null;
  returnDate: string;
  status: string;
  memo: string | null;
  createdBy: string;
  createdAt: string;
}
