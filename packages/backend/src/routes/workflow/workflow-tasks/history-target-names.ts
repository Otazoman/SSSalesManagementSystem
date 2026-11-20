import { inArray } from "drizzle-orm";
import * as schema from "../../../db/schema";

/**
 * BUG-119: 申請履歴の一覧に出す、申請の対象の名前(件名・マスタの名前)。以前は行ごとにアダプターでプレビュー(申請の中身)を読み、
 * その名前を使っていたため重かった。一覧では、申請の種類ごとに1回だけ、表の件名・名前の列を読む。
 * 表が無い種類・名前が空の対象は、対象の番号を名前にする(中身は行を開いた時に読む)。
 */
type NameSource = { table: any; id: any; name: any };

const NAME_SOURCES: Record<string, NameSource> = {
  sales_quotes: { table: schema.quotes, id: schema.quotes.id, name: schema.quotes.title },
  sales_orders: { table: schema.salesOrders, id: schema.salesOrders.id, name: schema.salesOrders.title },
  sales_invoices: { table: schema.salesInvoices, id: schema.salesInvoices.id, name: schema.salesInvoices.title },
  sales_billing: { table: schema.billingHeaders, id: schema.billingHeaders.id, name: schema.billingHeaders.title },
  purchase_payment: { table: schema.paymentHeaders, id: schema.paymentHeaders.id, name: schema.paymentHeaders.title },
  purchase_requisitions: { table: schema.purchaseRequests, id: schema.purchaseRequests.id, name: schema.purchaseRequests.title },
  purchase_orders: { table: schema.orders, id: schema.orders.id, name: schema.orders.title },
  purchase_recognitions: { table: schema.purchaseRecognitions, id: schema.purchaseRecognitions.id, name: schema.purchaseRecognitions.title },
  master_partners: { table: schema.partners, id: schema.partners.id, name: schema.partners.name },
  master_contacts: { table: schema.partnerContacts, id: schema.partnerContacts.id, name: schema.partnerContacts.name },
  master_delivery_destinations: {
    table: schema.partnerDeliveryDestinations,
    id: schema.partnerDeliveryDestinations.id,
    name: schema.partnerDeliveryDestinations.name,
  },
  master_products: { table: schema.items, id: schema.items.id, name: schema.items.name },
  master_units: { table: schema.units, id: schema.units.code, name: schema.units.name },
  master_accounts: { table: schema.accounts, id: schema.accounts.code, name: schema.accounts.name },
  master_warehouses: { table: schema.warehouses, id: schema.warehouses.id, name: schema.warehouses.name },
  master_locations: { table: schema.locations, id: schema.locations.id, name: schema.locations.name },
  master_business_locations: { table: schema.businessLocations, id: schema.businessLocations.id, name: schema.businessLocations.name },
  master_projects: { table: schema.projects, id: schema.projects.id, name: schema.projects.name },
};

/** `${targetType}:${targetId}` → 名前 */
export async function resolveHistoryTargetNames(
  db: any,
  targets: Array<{ targetType: string; targetId: string }>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const idsByType = new Map<string, Set<string>>();
  for (const t of targets) {
    if (!NAME_SOURCES[t.targetType]) continue;
    const set = idsByType.get(t.targetType) ?? new Set<string>();
    set.add(t.targetId);
    idsByType.set(t.targetType, set);
  }
  await Promise.all(
    [...idsByType.entries()].map(async ([targetType, ids]) => {
      const source = NAME_SOURCES[targetType];
      const rows: Array<{ id: string; name: string | null }> = await db
        .select({ id: source.id, name: source.name })
        .from(source.table)
        .where(inArray(source.id, [...ids]));
      for (const row of rows) {
        if (row.name && String(row.name).trim() !== "") names.set(`${targetType}:${row.id}`, String(row.name));
      }
    }),
  );
  return names;
}
