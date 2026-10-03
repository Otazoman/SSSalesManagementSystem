export interface ItemReorderSettingRecord {
  id: string;
  itemId: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  reorderPoint: number;
  safetyStock: number;
  memo: string | null;
}

export interface ItemLookup {
  id: string;
  name: string;
}

export interface WarehouseLookup {
  id: string;
  name: string;
}
