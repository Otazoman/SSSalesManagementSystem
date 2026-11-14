export interface ItemReorderSettingRecord {
  id: string;
  itemId: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  reorderPoint: number;
  safetyStock: number;
  memo: string | null;
  // BUG-098: 承認 ON の時は仮登録(temporary)もある。承認 OFF の間・今ある行は active
  status?: "active" | "temporary";
}

export interface ItemLookup {
  id: string;
  name: string;
}

export interface WarehouseLookup {
  id: string;
  name: string;
}
