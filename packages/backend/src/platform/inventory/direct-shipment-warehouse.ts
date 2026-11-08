import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { AppDb } from "../db/create-db";

// REQ-005: 直送(仕入先から得意先へ直接納品)の記録に使う仮の倉庫。区分は「直送」(DIRECT)。
// 直送完了で、発注とつながる入庫(この倉庫へ)と受注とつながる出庫(この倉庫から)を同時に確定するため、
// 在庫は常に0に戻る。倉庫の選択肢・在庫照会・引当・出荷指示・入荷指示の対象にはしない
export const DIRECT_SHIPMENT_WAREHOUSE_TYPE = "DIRECT";
const DIRECT_SHIPMENT_WAREHOUSE_ID = "WH-DIRECT";
const DIRECT_SHIPMENT_LOCATION_ID = "LOC-DIRECT";

/** 直送用の倉庫とロケーションを返す。無ければ作る(最初の直送完了の時) */
export async function ensureDirectShipmentWarehouse(
  db: AppDb,
  operatorId: string,
  now: Date,
): Promise<{ warehouseId: string; locationId: string }> {
  let [warehouse] = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.warehouseType, DIRECT_SHIPMENT_WAREHOUSE_TYPE))
    .limit(1);
  if (!warehouse) {
    await db
      .insert(schema.warehouses)
      .values({
        id: DIRECT_SHIPMENT_WAREHOUSE_ID,
        name: "直送",
        warehouseType: DIRECT_SHIPMENT_WAREHOUSE_TYPE,
        status: "active",
        memo: "直送完了の記録用(システムが自動で作成。在庫は常に0)",
        createdBy: operatorId,
        createdAt: now,
        updatedBy: operatorId,
        updatedAt: now,
      })
      .onConflictDoNothing();
    warehouse = { id: DIRECT_SHIPMENT_WAREHOUSE_ID };
  }

  let [location] = await db
    .select({ id: schema.locations.id })
    .from(schema.locations)
    .where(eq(schema.locations.warehouseId, warehouse.id))
    .limit(1);
  if (!location) {
    await db
      .insert(schema.locations)
      .values({
        id: DIRECT_SHIPMENT_LOCATION_ID,
        warehouseId: warehouse.id,
        name: "直送",
        status: "active",
        createdBy: operatorId,
        createdAt: now,
        updatedBy: operatorId,
        updatedAt: now,
      })
      .onConflictDoNothing();
    location = { id: DIRECT_SHIPMENT_LOCATION_ID };
  }
  return { warehouseId: warehouse.id, locationId: location.id };
}
