import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { BadRequestError } from "../http/http-error";

// REQ-005: 発注・購買申請の「直送」(仕入先から得意先へ直接納品)の指定を、保存する値に整える。
// 直送でなければ受注の指定は保存しない。直送の場合は、直送する受注が指定され、存在することを確かめる
export async function resolveDirectShipment(
  d1: D1Database,
  body: { isDirectShipment?: boolean; directSalesOrderId?: string | null },
): Promise<{ isDirectShipment: boolean; directSalesOrderId: string | null }> {
  if (body.isDirectShipment !== true) return { isDirectShipment: false, directSalesOrderId: null };
  const salesOrderId = body.directSalesOrderId || null;
  if (!salesOrderId) {
    throw new BadRequestError("直送の場合は、直送する受注を指定してください");
  }
  const [salesOrder] = await drizzle(d1, { schema })
    .select({ id: schema.salesOrders.id })
    .from(schema.salesOrders)
    .where(eq(schema.salesOrders.id, salesOrderId))
    .limit(1);
  if (!salesOrder) {
    throw new BadRequestError(`直送する受注[${salesOrderId}]が見つかりません`);
  }
  return { isDirectShipment: true, directSalesOrderId: salesOrderId };
}
