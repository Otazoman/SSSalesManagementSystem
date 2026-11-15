// REQ-011(2): 一時保管の台帳(品目マスタに無い物を、在庫とは別に管理する)
export type HoldingCategory = "OWN" | "CUSTODY";
export type HoldingStatus = "HOLDING" | "RELEASED" | "MOVED_TO_STOCK";
export type HoldingMovementType = "RECEIVE" | "RELEASE" | "ADJUST" | "MOVE_TO_STOCK";
export type HoldingApprovalStatus = "PENDING" | "CONFIRMED" | "REMANDED";

export interface TemporaryHolding {
  id: string;
  category: HoldingCategory;
  itemName: string;
  spec: string | null;
  quantity: number;
  /** 承認待ちの増減(台帳の数量にはまだ入っていない) */
  pendingQuantity?: number;
  unitName: string | null;
  warehouseId: string;
  locationId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceItemId: string | null;
  partnerId: string | null;
  receivedDate: string;
  plannedReleaseDate: string | null;
  status: HoldingStatus;
}

export interface TemporaryHoldingMovement {
  id: string;
  holdingId: string;
  movementType: HoldingMovementType;
  quantity: number;
  movementDate: string;
  memo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceItemId: string | null;
  approvalStatus: HoldingApprovalStatus;
  createdBy: string;
}

export interface TemporaryHoldingDetail extends TemporaryHolding {
  movements: TemporaryHoldingMovement[];
}

export const HOLDING_CATEGORY_LABELS: Record<HoldingCategory, string> = { OWN: "自社品", CUSTODY: "預り品" };
export const HOLDING_STATUS_LABELS: Record<HoldingStatus, string> = {
  HOLDING: "保管中",
  RELEASED: "払出済",
  MOVED_TO_STOCK: "在庫へ移行済",
};
export const HOLDING_MOVEMENT_LABELS: Record<HoldingMovementType, string> = {
  RECEIVE: "受入",
  RELEASE: "払出",
  ADJUST: "調整",
  MOVE_TO_STOCK: "在庫へ移行",
};
