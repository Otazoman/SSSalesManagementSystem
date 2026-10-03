import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../../db/schema";

/**
 * Item7残課題2-5: 倉庫単位の受注在庫引当。
 *
 * stock-reservation.repository.ts(品目単位・全倉庫合算、レガシー)はこの機能のリリース前に
 * 承認済みだった受注専用として温存し、変更しない。新規の受注はこちら(倉庫単位)を使う。
 * データ移行は行わない(リリース後に新規作成・提出される受注のみ新方式)。
 *
 * warehouseStockReservations(品目×倉庫の高速カウンタ)が原子的な排他制御を担い、
 * salesOrderItemReservations(受注明細×倉庫の引当実績ledger)がどの受注のどの明細が
 * いくら引き当てたかのトレーサビリティを担う(stocks:stockTransactionsと同じ関係)。
 */
export class WarehouseStockReservationRepository {
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

  static fromDb(
    db: ReturnType<typeof drizzle<typeof schema>>,
  ): WarehouseStockReservationRepository {
    const repo = Object.create(
      WarehouseStockReservationRepository.prototype,
    ) as WarehouseStockReservationRepository;
    repo.db = db;
    return repo;
  }

  // 品目1件について、倉庫ごとの利用可能数量(在庫合計-引当済数量)を在庫が多い順に返す。
  // FIFO自動割当・#2の参照表示の両方から使う
  async getAvailableByWarehouse(
    itemId: string,
  ): Promise<Array<{ warehouseId: string; warehouseName: string; available: number }>> {
    const stockRows = await this.db
      .select({
        warehouseId: schema.stocks.warehouseId,
        warehouseName: schema.warehouses.name,
        total: sql<number>`SUM(${schema.stocks.quantity})`,
      })
      .from(schema.stocks)
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.stocks.warehouseId))
      .where(and(eq(schema.stocks.itemId, itemId), eq(schema.stocks.qualityStatus, "NORMAL")))
      .groupBy(schema.stocks.warehouseId, schema.warehouses.name);

    const reservedRows = await this.db
      .select({
        warehouseId: schema.warehouseStockReservations.warehouseId,
        reservedQuantity: schema.warehouseStockReservations.reservedQuantity,
      })
      .from(schema.warehouseStockReservations)
      .where(eq(schema.warehouseStockReservations.itemId, itemId));
    const reservedByWarehouse = new Map(reservedRows.map((r) => [r.warehouseId, r.reservedQuantity]));

    return stockRows
      .map((row) => ({
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        available: Number(row.total || 0) - (reservedByWarehouse.get(row.warehouseId) || 0),
      }))
      .sort((a, b) => b.available - a.available);
  }

  // 指定倉庫の在庫を quantity 分だけ引き当てる(原子的、stock-reservation.repository.tsの
  // tryReserve()と同じ「WHERE句に残量条件を入れた単一UPDATE文」パターンを倉庫単位に拡張)
  async tryReserve(
    itemId: string,
    warehouseId: string,
    quantity: number,
    now: Date,
  ): Promise<boolean> {
    if (quantity <= 0) return true;

    await this.db
      .insert(schema.warehouseStockReservations)
      .values({ itemId, warehouseId, reservedQuantity: 0, updatedAt: now })
      .onConflictDoNothing();

    const result = await this.db
      .update(schema.warehouseStockReservations)
      .set({
        reservedQuantity: sql`${schema.warehouseStockReservations.reservedQuantity} + ${quantity}`,
        updatedAt: now,
      })
      .where(
        sql`${schema.warehouseStockReservations.itemId} = ${itemId} AND ${schema.warehouseStockReservations.warehouseId} = ${warehouseId} AND (
          COALESCE(
            (SELECT SUM(${schema.stocks.quantity}) FROM ${schema.stocks}
              WHERE ${schema.stocks.itemId} = ${itemId} AND ${schema.stocks.warehouseId} = ${warehouseId}
                AND ${schema.stocks.qualityStatus} = 'NORMAL'),
            0
          ) - ${schema.warehouseStockReservations.reservedQuantity}
        ) >= ${quantity}`,
      );

    return result.meta.changes > 0;
  }

  async release(itemId: string, warehouseId: string, quantity: number, now: Date): Promise<void> {
    if (quantity <= 0) return;

    await this.db
      .update(schema.warehouseStockReservations)
      .set({
        reservedQuantity: sql`MAX(${schema.warehouseStockReservations.reservedQuantity} - ${quantity}, 0)`,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.warehouseStockReservations.itemId, itemId),
          eq(schema.warehouseStockReservations.warehouseId, warehouseId),
        ),
      );
  }

  async insertReservationLedgerRow(
    salesOrderItemId: string,
    warehouseId: string,
    quantity: number,
    now: Date,
  ): Promise<void> {
    await this.db.insert(schema.salesOrderItemReservations).values({
      id: crypto.randomUUID(),
      salesOrderItemId,
      warehouseId,
      reservedQuantity: quantity,
      createdAt: now,
      updatedAt: now,
    });
  }

  async findReservationsByOrderItemIds(
    orderItemIds: string[],
  ): Promise<Array<typeof schema.salesOrderItemReservations.$inferSelect>> {
    if (orderItemIds.length === 0) return [];
    return await this.db
      .select()
      .from(schema.salesOrderItemReservations)
      .where(inArray(schema.salesOrderItemReservations.salesOrderItemId, orderItemIds));
  }

  // Item7残課題6: 出庫実績確定により実際に出荷された分だけ、ledgerを古い順に消費する
  // (0になった行は削除)。カウンタ側の減算はrelease()を別途呼ぶ側の責務とする
  async consumeReservationLedger(
    salesOrderItemId: string,
    warehouseId: string,
    quantity: number,
    now: Date,
  ): Promise<void> {
    if (quantity <= 0) return;

    const rows = await this.db
      .select()
      .from(schema.salesOrderItemReservations)
      .where(
        and(
          eq(schema.salesOrderItemReservations.salesOrderItemId, salesOrderItemId),
          eq(schema.salesOrderItemReservations.warehouseId, warehouseId),
        ),
      )
      .orderBy(asc(schema.salesOrderItemReservations.createdAt));

    // BUG-048: 消費する行の削除・減算は1回の batch で書き込む(途中で失敗して一部の行だけ消費されないように)
    const statements: any[] = [];
    let remaining = quantity;
    for (const row of rows) {
      if (remaining <= 0) break;
      if (row.reservedQuantity <= remaining) {
        statements.push(
          this.db.delete(schema.salesOrderItemReservations).where(eq(schema.salesOrderItemReservations.id, row.id)),
        );
        remaining -= row.reservedQuantity;
      } else {
        statements.push(
          this.db
            .update(schema.salesOrderItemReservations)
            .set({ reservedQuantity: row.reservedQuantity - remaining, updatedAt: now })
            .where(eq(schema.salesOrderItemReservations.id, row.id)),
        );
        remaining = 0;
      }
    }
    if (statements.length > 0) await this.db.batch(statements as [any, ...any[]]);
  }
}

export interface WarehouseAllocationRequestLine {
  warehouseId: string;
  quantity: number;
}

export interface WarehouseAwareOrderItem {
  id: string; // sales_order_items.id
  itemId: string | null;
  quantity: number;
  inputType?: string | null;
  // DBに保存されているJSON文字列(未指定はnull)。パース失敗時は自動FIFO割当にフォールバックする
  warehouseAllocationRequest?: string | null;
}

export interface WarehouseAwareReservationResult {
  reservations: WarehouseAllocationRequestLine[];
  backorderedQuantity: number;
}

function isReservableLine(item: WarehouseAwareOrderItem): item is WarehouseAwareOrderItem & { itemId: string } {
  return !!item.itemId && item.inputType === "MASTER";
}

function parseAllocationRequest(raw?: string | null): WarehouseAllocationRequestLine[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const lines = parsed.filter(
      (l): l is WarehouseAllocationRequestLine =>
        l && typeof l.warehouseId === "string" && typeof l.quantity === "number" && l.quantity > 0,
    );
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

// 受注明細1件を引き当てる。手動の倉庫内訳指定(warehouseAllocationRequest)があればその通りに、
// なければ在庫が多い倉庫順に自動でFIFO割当する(複数倉庫にまたがってもよい)。
// 不足分は失敗として扱わずbackorderedQuantityに積む(与信警告と同じ非ブロッキング方針)
async function reserveSingleItem(
  repo: WarehouseStockReservationRepository,
  itemId: string,
  quantity: number,
  allocationRequest: WarehouseAllocationRequestLine[] | null,
  now: Date,
): Promise<WarehouseAwareReservationResult> {
  const reservations: WarehouseAllocationRequestLine[] = [];
  let remaining = quantity;

  if (allocationRequest) {
    // 指定倉庫の実際の在庫を超える指定だった場合、確保できる分だけ引き当てて残りはバックオーダーにする
    // (全量が無ければ何も引き当てない、という挙動にはしない。非ブロッキング方針を優先する)
    const availableByWarehouse = new Map(
      (await repo.getAvailableByWarehouse(itemId)).map((c) => [c.warehouseId, c.available]),
    );
    for (const line of allocationRequest) {
      if (remaining <= 0) break;
      const availableHere = Math.max(availableByWarehouse.get(line.warehouseId) || 0, 0);
      const want = Math.min(line.quantity, remaining, availableHere);
      if (want <= 0) continue;
      const ok = await repo.tryReserve(itemId, line.warehouseId, want, now);
      if (ok) {
        reservations.push({ warehouseId: line.warehouseId, quantity: want });
        remaining -= want;
      }
    }
    return { reservations, backorderedQuantity: Math.max(remaining, 0) };
  }

  const candidates = await repo.getAvailableByWarehouse(itemId);
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    if (candidate.available <= 0) continue;
    const want = Math.min(candidate.available, remaining);
    const ok = await repo.tryReserve(itemId, candidate.warehouseId, want, now);
    if (ok) {
      reservations.push({ warehouseId: candidate.warehouseId, quantity: want });
      remaining -= want;
    }
  }
  return { reservations, backorderedQuantity: Math.max(remaining, 0) };
}

// 受注全体を引き当てる。品目ごとの合算はせず明細行単位で処理する(倉庫内訳は行ごとに異なりうるため)。
// 途中で失敗しても他の明細のロールバックは行わない(不足=バックオーダーとして許容する設計のため、
// レガシーのreserveOrderItemsOrRollbackと異なり全体失敗という概念自体が無い)
export async function reserveOrderItemsWarehouseAware(
  repo: WarehouseStockReservationRepository,
  items: WarehouseAwareOrderItem[],
  now: Date,
): Promise<Map<string, WarehouseAwareReservationResult>> {
  const results = new Map<string, WarehouseAwareReservationResult>();
  // BUG-056: サービス品目(isService)は在庫を持たないため対象外
  const serviceItemIds = await repo.findServiceItemIds(items.map((item) => item.itemId));
  for (const item of items) {
    if (!isReservableLine(item) || serviceItemIds.has(item.itemId)) continue;
    const allocationRequest = parseAllocationRequest(item.warehouseAllocationRequest);
    const result = await reserveSingleItem(repo, item.itemId, item.quantity, allocationRequest, now);
    for (const r of result.reservations) {
      await repo.insertReservationLedgerRow(item.id, r.warehouseId, r.quantity, now);
    }
    results.set(item.id, result);
  }
  return results;
}

// Item7残課題2-5: バックオーダー(引当できなかった残数量)の手動再引当。
// 入庫等で在庫が増えた後、在庫一覧/受注画面からの手動操作で呼ばれる。常に自動FIFO割当のみを行う
// (元の手動倉庫内訳指定は初回引当で使い切ったものとして扱い、再試行では再現しない)
export async function retryBackorderedItems(
  repo: WarehouseStockReservationRepository,
  items: Array<{ id: string; itemId: string | null; inputType?: string | null; backorderedQuantity: number }>,
  now: Date,
): Promise<Map<string, WarehouseAwareReservationResult>> {
  const results = new Map<string, WarehouseAwareReservationResult>();
  // BUG-056: サービス品目(isService)は在庫を持たないため対象外
  const serviceItemIds = await repo.findServiceItemIds(items.map((item) => item.itemId));
  for (const item of items) {
    if (item.backorderedQuantity <= 0) continue;
    if (!isReservableLine({ ...item, quantity: item.backorderedQuantity })) continue;
    if (serviceItemIds.has(item.itemId as string)) continue;
    const result = await reserveSingleItem(repo, item.itemId as string, item.backorderedQuantity, null, now);
    for (const r of result.reservations) {
      await repo.insertReservationLedgerRow(item.id, r.warehouseId, r.quantity, now);
    }
    results.set(item.id, result);
  }
  return results;
}

// 受注削除時、明細に対応する倉庫単位引当を一括解放する(ledgerの実績に基づく。
// レガシーのreleaseOrderItemsとは異なり、品目合算の見積もりではなく実際に引き当てた
// 倉庫ごとの実績をそのまま解放するため過不足が生じない)
export async function releaseOrderItemsWarehouseAware(
  repo: WarehouseStockReservationRepository,
  items: Array<{ id: string; itemId: string | null }>,
  now: Date,
): Promise<void> {
  const orderItemIds = items.map((i) => i.id);
  const reservations = await repo.findReservationsByOrderItemIds(orderItemIds);
  if (reservations.length === 0) return;

  const itemIdByOrderItemId = new Map(items.map((i) => [i.id, i.itemId]));
  for (const r of reservations) {
    const itemId = itemIdByOrderItemId.get(r.salesOrderItemId);
    if (!itemId) continue;
    await repo.release(itemId, r.warehouseId, r.reservedQuantity, now);
  }
}

// Item7残課題6: 出荷指示/出庫の実績が確定(在庫が実際に減算)したタイミングで、その分だけ
// 受注明細の在庫引当を解放する。出荷指示の発行時点(在庫は動かない)では呼ばない
export async function releaseReservationForShippedQuantity(
  repo: WarehouseStockReservationRepository,
  salesOrderItemId: string,
  itemId: string,
  warehouseId: string,
  quantity: number,
  now: Date,
): Promise<void> {
  if (quantity <= 0) return;
  await repo.consumeReservationLedger(salesOrderItemId, warehouseId, quantity, now);
  await repo.release(itemId, warehouseId, quantity, now);
}

// Item7残課題2-5フォローアップ6(2026-08-27): 承認機能ON時、在庫は「早い者勝ち」で
// 他の受注に先に消費されうる資源のため、与信確認とは異なり承認確定時ではなく
// 申請提出時点で確保する必要がある(ユーザー確認済み)。
//
// UPDATE(承認済み受注への変更申請)は、承認されるまで実際のsales_order_items行を
// 書き換えない設計(スナップショットをJSONで退避するのみ)のため、申請時点ではまだ
// 「新しい数量の明細行」自体がDB上に存在しない。そのため、以下の3関数一式で
// 「行が無くてもカウンタだけは正しく確保しておき、確定時に確定済みの実績をledgerへ
// 書き込むだけにする(在庫チェックはもう一度行わない)」という2段階方式を取る:
//   1. adjustReservationForUpdateSubmission (申請提出時): 旧明細の引当をカウンタから解放し、
//      新明細に対して引当を試みる。ledgerへの書込みは行わない(新明細行がまだ無いため)。
//      戻り値(どの倉庫からいくら確保できたか)を呼び出し元がスナップショットと一緒に保存する。
//   2. applyPendingUpdateReservationOutcome (承認確定時): 新明細行が実際に作成された後、
//      保存しておいた確保実績をledgerへ書き込むだけ。カウンタには一切触れない
//      (既に申請提出時点で正しい状態になっているため、ここで在庫チェックをやり直すと二重処理になる)。
//   3. revertPendingUpdateReservationOutcome (差戻し・取消時): 申請提出時に確保した新明細分を
//      解放し、旧明細のledger(申請中も一切書き換えていないため実績がそのまま残っている)を
//      元に同じ数量を再確保して、申請前の状態へ復元する。

export interface PendingUpdateReservationOutcomeItem {
  // 新明細配列(snapshot.items)内でのindex。承認確定時に実際に作成された明細行と
  // 同じ並び順で対応付けるためのキー(まだ実IDが無い時点の識別子として使う)
  index: number;
  itemId: string;
  reservations: WarehouseAllocationRequestLine[];
  backorderedQuantity: number;
}

export interface PendingUpdateReservationOutcome {
  items: PendingUpdateReservationOutcomeItem[];
}

export async function adjustReservationForUpdateSubmission(
  repo: WarehouseStockReservationRepository,
  oldItems: Array<{ id: string; itemId: string | null }>,
  newItems: WarehouseAwareOrderItem[],
  now: Date,
): Promise<PendingUpdateReservationOutcome> {
  // 1. 旧明細の引当をカウンタから解放する(ledger行自体はここでは消さない。差戻し時の
  // 復元元として必要なため、実明細行が削除される承認確定時まで残しておく)
  await releaseOrderItemsWarehouseAware(repo, oldItems, now);

  // 2. 新明細に対して引当を試みる(ledgerへの書込みは行わない、対象の実明細行がまだ無いため)
  const outcomeItems: PendingUpdateReservationOutcomeItem[] = [];
  // BUG-056: サービス品目(isService)は在庫を持たないため対象外
  const serviceItemIds = await repo.findServiceItemIds(newItems.map((item) => item.itemId));
  for (let index = 0; index < newItems.length; index++) {
    const item = newItems[index];
    if (!isReservableLine(item) || serviceItemIds.has(item.itemId)) continue;
    const allocationRequest = parseAllocationRequest(item.warehouseAllocationRequest);
    const result = await reserveSingleItem(repo, item.itemId, item.quantity, allocationRequest, now);
    outcomeItems.push({
      index,
      itemId: item.itemId,
      reservations: result.reservations,
      backorderedQuantity: result.backorderedQuantity,
    });
  }
  return { items: outcomeItems };
}

export async function applyPendingUpdateReservationOutcome(
  repo: WarehouseStockReservationRepository,
  outcome: PendingUpdateReservationOutcome,
  newOrderItems: Array<{ id: string }>,
  now: Date,
): Promise<void> {
  for (const outcomeItem of outcome.items) {
    const orderItem = newOrderItems[outcomeItem.index];
    if (!orderItem) continue;
    for (const r of outcomeItem.reservations) {
      await repo.insertReservationLedgerRow(orderItem.id, r.warehouseId, r.quantity, now);
    }
  }
}

export async function revertPendingUpdateReservationOutcome(
  repo: WarehouseStockReservationRepository,
  outcome: PendingUpdateReservationOutcome,
  oldItems: Array<{ id: string; itemId: string | null }>,
  now: Date,
): Promise<void> {
  // 1. 申請提出時に新明細分として確保していたものを解放する
  for (const outcomeItem of outcome.items) {
    for (const r of outcomeItem.reservations) {
      await repo.release(outcomeItem.itemId, r.warehouseId, r.quantity, now);
    }
  }

  // 2. 旧明細のledger実績(申請中も書き換えていないためそのまま残っている)を元に、
  // 同じ数量を再確保して申請前の状態へ復元する。ベストエフォート(差戻し・取消は
  // 非committing操作のため、直前に他の処理が同じ在庫を先に確保していても致命的エラーにはしない)
  const oldItemIds = oldItems.map((i) => i.id);
  const oldReservations = await repo.findReservationsByOrderItemIds(oldItemIds);
  const itemIdByOrderItemId = new Map(oldItems.map((i) => [i.id, i.itemId]));
  for (const r of oldReservations) {
    const itemId = itemIdByOrderItemId.get(r.salesOrderItemId);
    if (!itemId) continue;
    await repo.tryReserve(itemId, r.warehouseId, r.reservedQuantity, now);
  }
}

export interface StockShortagePreviewItem {
  itemId: string;
  requestedQuantity: number;
  // 全倉庫合算の利用可能数量。ここが不足していれば、倉庫をどう組み合わせても引当不可能
  totalAvailable: number;
  // 倉庫内訳を手動指定している場合のみ、その倉庫単体で不足している行を積む
  // (全体では足りていても、指定した特定倉庫では足りないケースを個別に警告するため)
  warehouseShortfalls: Array<{ warehouseId: string; requested: number; available: number }>;
}

// Item7残課題2-5: 与信警告と同じ非破壊のプレビュー用チェック。実際の引当(warehouse_stock_reservations
// への書込み)は行わない。承認フラグのON/OFFに関わらず、保存・承認申請の各時点で「まず全体で
// 足りるか」→「倉庫内訳を指定している場合はその倉庫単体でも足りるか」の2段階でチェックする
export async function previewStockShortage(
  repo: WarehouseStockReservationRepository,
  items: WarehouseAwareOrderItem[],
): Promise<StockShortagePreviewItem[]> {
  // 同一受注内に同じ商品が複数明細ある場合に対応するため、品目単位で数量・倉庫内訳を合算する
  const byItem = new Map<
    string,
    { quantity: number; allocationRequest: WarehouseAllocationRequestLine[] }
  >();
  // BUG-056: サービス品目(isService)は在庫を持たないため対象外
  const serviceItemIds = await repo.findServiceItemIds(items.map((item) => item.itemId));
  for (const item of items) {
    if (!isReservableLine(item) || serviceItemIds.has(item.itemId)) continue;
    const existing = byItem.get(item.itemId) || { quantity: 0, allocationRequest: [] };
    existing.quantity += item.quantity;
    const req = parseAllocationRequest(item.warehouseAllocationRequest);
    if (req) existing.allocationRequest.push(...req);
    byItem.set(item.itemId, existing);
  }

  const shortages: StockShortagePreviewItem[] = [];
  for (const [itemId, { quantity, allocationRequest }] of byItem) {
    const availability = await repo.getAvailableByWarehouse(itemId);
    // 1段階目: まず全体(全倉庫合算)で足りるか
    const totalAvailable = availability.reduce((sum, a) => sum + Math.max(a.available, 0), 0);

    // 2段階目: 倉庫内訳を指定している場合、その倉庫単体でも足りるか
    const warehouseShortfalls: StockShortagePreviewItem["warehouseShortfalls"] = [];
    if (allocationRequest.length > 0) {
      const availByWarehouse = new Map(availability.map((a) => [a.warehouseId, a.available]));
      for (const line of allocationRequest) {
        const available = Math.max(availByWarehouse.get(line.warehouseId) || 0, 0);
        if (available < line.quantity) {
          warehouseShortfalls.push({ warehouseId: line.warehouseId, requested: line.quantity, available });
        }
      }
    }

    if (totalAvailable < quantity || warehouseShortfalls.length > 0) {
      shortages.push({ itemId, requestedQuantity: quantity, totalAvailable, warehouseShortfalls });
    }
  }
  return shortages;
}
