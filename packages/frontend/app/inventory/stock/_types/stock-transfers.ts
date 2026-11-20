// REQ-006: 倉庫間移動(横持ち)
export type StockTransferStatus =
  | "SHIPPING_PENDING"
  | "IN_TRANSIT"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CLOSED_WITH_DIFFERENCE"
  | "CANCELED";

export interface StockTransferItem {
  id: string;
  transferId: string;
  itemId: string;
  lotNumber: string;
  accountCode: string | null;
  sourceLocationId: string | null;
  quantity: number;
  receivedQuantity: number;
  differenceQuantity: number;
  sortOrder: number;
  /** 承認待ちの入庫の数量(詳細だけ) */
  pendingReceiptQuantity?: number;
}

export interface StockTransfer {
  id: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  shippedDate: string;
  status: StockTransferStatus;
  shipmentId: string | null;
  shipmentInstructionId: string | null;
  receiptInstructionId: string | null;
  closedReason: string | null;
  memo: string | null;
  items: StockTransferItem[];
}

export interface StockTransferDetail extends StockTransfer {
  shipment: { id: string; status: string } | null;
  receipts: Array<{ id: string; status: string; receivedDate: string }>;
}

export interface InTransitRow {
  transferId: string;
  shippedDate: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  itemId: string;
  lotNumber: string;
  quantity: number;
}

export const TRANSFER_STATUS_LABELS: Record<StockTransferStatus, string> = {
  SHIPPING_PENDING: "出庫の承認待ち",
  IN_TRANSIT: "輸送中",
  PARTIALLY_RECEIVED: "一部入庫",
  RECEIVED: "入庫済み",
  CLOSED_WITH_DIFFERENCE: "差異で完了",
  CANCELED: "取消",
};

export const TRANSFER_STATUS_TONES = {
  SHIPPING_PENDING: "amber",
  IN_TRANSIT: "sky",
  PARTIALLY_RECEIVED: "orange",
  RECEIVED: "emerald",
  CLOSED_WITH_DIFFERENCE: "red",
  CANCELED: "slate",
} as const;

/** 輸送中の残り(出庫数 − 入庫済み − 差異) */
export const remainingOf = (item: StockTransferItem) => Math.max(item.quantity - item.receivedQuantity - item.differenceQuantity, 0);
