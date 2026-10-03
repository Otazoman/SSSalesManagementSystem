export interface AuditRecord {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  theoreticalQuantity: number;
  countedQuantity: number;
  differenceQuantity: number;
  status: string;
  memo: string | null;
  createdBy: string;
  createdAt: string;
}
