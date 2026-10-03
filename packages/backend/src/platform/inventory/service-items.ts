import { and, eq, inArray } from "drizzle-orm";
import { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../db/schema";

// BUG-056・BUG-065: 品目マスタでサービス(isService)の品目id。サービス(役務)は在庫を持たないため、在庫の引当・
// 不足確認・出荷・入荷の対象外にし、「出荷済み(入荷済み)数量まで」の設定でも受注(発注)数量まで計上できるようにする。
// D1は1文100変数までのため、90件ずつ問い合わせる
export async function selectServiceItemIds(
  db: DrizzleD1Database<typeof schema>,
  itemIds: Array<string | null | undefined>,
): Promise<Set<string>> {
  const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
  const result = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await db
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(and(inArray(schema.items.id, ids.slice(i, i + 90)), eq(schema.items.isService, true)));
    for (const r of rows) result.add(r.id);
  }
  return result;
}
