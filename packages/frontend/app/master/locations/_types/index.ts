import { IdNameLookup } from "../../../_shared/types/lookup";

export interface LocationRecord {
  id: string;
  warehouseId: string;
  name: string;
  memo: string | null;
  status?: "temporary" | "active" | "suspended" | string;
}

export type WarehouseSimple = IdNameLookup;
