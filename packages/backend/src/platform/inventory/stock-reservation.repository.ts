import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../../db/schema";

/**
 * Item7: 受注確定(APPROVED)時のハード在庫引当。品目単位の合計値のみを扱う
 * (倉庫・ロケーション・ロットは出荷時に決まるため、受注時点では持たない)。
 *
 * 同時実行の安全性は、既存の`StockRepository.decreaseQuantity()`が採用している
 * 「WHERE句に残量条件を入れた単一UPDATE文+影響行数チェック」という原子的パターンを踏襲する
 * (D1では複数文にまたがる真のトランザクションロールバックが容易ではないため、
 * 1文で完結する条件付き更新にすることで競合を安全に検知する)。
 */
export class StockReservationRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  // BUG-056: 品目マスタでサービス(isService)の品目id。在庫を持たないため、引当・不足確認の対象外にする。
  // D1は1文100変数までのため、90件ずつ問い合わせる
  async findServiceItemIds(itemIds: Array<string | null | undefined>): Promise<Set<string>> {
    const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
    const result = new Set<string>();
    for (let i = 0; i < ids.length; i += 90) {
      const rows = await this.db
        .select({ id: schema.items.id })
        .from(schema.items)
        .where(and(inArray(schema.items.id, ids.slice(i, i + 90)), eq(schema.items.isService, true)));
      for (const r of rows) result.add(r.id);
    }
    return result;
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): StockReservationRepository {
    const repo = Object.create(StockReservationRepository.prototype) as StockReservationRepository;
    repo.db = db;
    return repo;
  }

  // 指定品目の在庫を quantity 分だけ引き当てる(予約)。
  // 利用可能数量(SUM(stocks.quantity WHERE qualityStatus='NORMAL') - reservedQuantity)が
  // quantity未満の場合は何も更新せずfalseを返す(呼び出し元が在庫不足として扱う)。
  async tryReserve(itemId: string, quantity: number, now: Date): Promise<boolean> {
    if (quantity <= 0) return true;

    // 行が存在しない場合の初期化(冪等、競合しても実害なし)
    await this.db
      .insert(schema.itemStockReservations)
      .values({ itemId, reservedQuantity: 0, updatedAt: now })
      .onConflictDoNothing();

    const result = await this.db
      .update(schema.itemStockReservations)
      .set({
        reservedQuantity: sql`${schema.itemStockReservations.reservedQuantity} + ${quantity}`,
        updatedAt: now,
      })
      .where(
        sql`${schema.itemStockReservations.itemId} = ${itemId} AND (
          COALESCE(
            (SELECT SUM(${schema.stocks.quantity}) FROM ${schema.stocks}
              WHERE ${schema.stocks.itemId} = ${itemId} AND ${schema.stocks.qualityStatus} = 'NORMAL'),
            0
          ) - ${schema.itemStockReservations.reservedQuantity}
        ) >= ${quantity}`,
      );

    return result.meta.changes > 0;
  }

  // 引当を解放する(出荷による消込の進行、または受注削除時)。マイナスにはならないよう下限0でクランプする
  async release(itemId: string, quantity: number, now: Date): Promise<void> {
    if (quantity <= 0) return;

    await this.db
      .update(schema.itemStockReservations)
      .set({
        reservedQuantity: sql`MAX(${schema.itemStockReservations.reservedQuantity} - ${quantity}, 0)`,
        updatedAt: now,
      })
      .where(eq(schema.itemStockReservations.itemId, itemId));
  }

  async getReservedQuantity(itemId: string): Promise<number> {
    const res = await this.db
      .select({ reservedQuantity: schema.itemStockReservations.reservedQuantity })
      .from(schema.itemStockReservations)
      .where(eq(schema.itemStockReservations.itemId, itemId))
      .limit(1);
    return res[0]?.reservedQuantity ?? 0;
  }
}

export interface ReservationLineInput {
  itemId: string | null;
  quantity: number;
  // DIRECT入力(itemsマスタに存在しない自由入力品目)は物理在庫の概念自体を持たないため、
  // 明示的に"MASTER"の明細のみを引当対象にする(未設定・DIRECT等は在庫不足扱いにせず素通しする、
  // 安全側=誤って確定をブロックしない方向のフォールバック)
  inputType?: string | null;
}

function isReservableLine(item: ReservationLineInput): item is ReservationLineInput & { itemId: string } {
  return !!item.itemId && item.inputType === "MASTER";
}

// 品目単位で合算してから引き当てる(同一受注に同じ商品が複数行あるケースに対応)。
// 途中の品目で在庫不足になった場合、それまでに成功した分をこの呼び出し内でロールバックしてから
// 失敗として返す(D1では複数UPDATEをまたぐ真のトランザクションロールバックが容易ではないため、
// アプリ側で補償する)
export async function reserveOrderItemsOrRollback(
  repo: StockReservationRepository,
  items: ReservationLineInput[],
  now: Date,
): Promise<{ success: boolean; failedItemId?: string }> {
  const totals = new Map<string, number>();
  // BUG-056: サービス品目(isService)は在庫を持たないため対象外
  const serviceItemIds = await repo.findServiceItemIds(items.map((item) => item.itemId));
  for (const item of items) {
    if (!isReservableLine(item) || serviceItemIds.has(item.itemId)) continue;
    totals.set(item.itemId, (totals.get(item.itemId) || 0) + item.quantity);
  }

  const reserved: Array<{ itemId: string; quantity: number }> = [];
  for (const [itemId, quantity] of totals) {
    const ok = await repo.tryReserve(itemId, quantity, now);
    if (!ok) {
      for (const done of reserved) {
        await repo.release(done.itemId, done.quantity, now);
      }
      return { success: false, failedItemId: itemId };
    }
    reserved.push({ itemId, quantity });
  }
  return { success: true };
}

// 受注削除時等、明細に対応する引当を一括解放する
export async function releaseOrderItems(
  repo: StockReservationRepository,
  items: ReservationLineInput[],
  now: Date,
): Promise<void> {
  const totals = new Map<string, number>();
  // BUG-056: サービス品目(isService)は在庫を持たないため対象外
  const serviceItemIds = await repo.findServiceItemIds(items.map((item) => item.itemId));
  for (const item of items) {
    if (!isReservableLine(item) || serviceItemIds.has(item.itemId)) continue;
    totals.set(item.itemId, (totals.get(item.itemId) || 0) + item.quantity);
  }
  for (const [itemId, quantity] of totals) {
    await repo.release(itemId, quantity, now);
  }
}
