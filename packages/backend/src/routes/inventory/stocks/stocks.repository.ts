import { drizzle } from "drizzle-orm/d1";
import { eq, and, gt, sql, count, desc } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { GetStocksQuery } from "./stocks.schema";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";

// ヘッダクリックソート(追加要望D)の許可カラム
const STOCKS_SORT_COLUMNS = {
  itemId: schema.stocks.itemId,
  warehouseId: schema.stocks.warehouseId,
  locationId: schema.stocks.locationId,
  lotNumber: schema.stocks.lotNumber,
  qualityStatus: schema.stocks.qualityStatus,
  quantity: schema.stocks.quantity,
  updatedAt: schema.stocks.updatedAt,
};

export type StockKey = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
};

export class StockRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): StockRepository {
    const repo = Object.create(StockRepository.prototype) as StockRepository;
    repo.db = db;
    return repo;
  }

  private buildStockConditions(searchParams: GetStocksQuery) {
    // 数量0の行(品質区分変更・出庫等で在庫が払い出された残骸)は一覧に出しても意味がないため、
    // 常に除外する(行自体はDBに残るため、再入庫時はincreaseQuantity()が同じ行を見つけて
    // 更新するだけで、数量が入り次第また自動的に一覧へ現れる)
    const conditions = [gt(schema.stocks.quantity, 0)];
    if (searchParams.itemId)
      conditions.push(eq(schema.stocks.itemId, searchParams.itemId));
    if (searchParams.warehouseId)
      conditions.push(eq(schema.stocks.warehouseId, searchParams.warehouseId));
    if (searchParams.locationId)
      conditions.push(eq(schema.stocks.locationId, searchParams.locationId));
    if (searchParams.qualityStatus)
      conditions.push(eq(schema.stocks.qualityStatus, searchParams.qualityStatus));
    return conditions;
  }

  private buildStockListQuery(searchParams: GetStocksQuery, sort: SortQuery = {}) {
    const conditions = this.buildStockConditions(searchParams);
    const orderBy = buildOrderBy(sort, STOCKS_SORT_COLUMNS);
    const query = this.db
      .select({
        id: schema.stocks.id,
        itemId: schema.stocks.itemId,
        itemName: schema.items.name,
        warehouseId: schema.stocks.warehouseId,
        warehouseName: schema.warehouses.name,
        locationId: schema.stocks.locationId,
        locationName: schema.locations.name,
        lotNumber: schema.stocks.lotNumber,
        accountCode: schema.stocks.accountCode,
        qualityStatus: schema.stocks.qualityStatus,
        quantity: schema.stocks.quantity,
        updatedAt: schema.stocks.updatedAt,
      })
      .from(schema.stocks)
      .leftJoin(schema.items, eq(schema.stocks.itemId, schema.items.id))
      .leftJoin(
        schema.warehouses,
        eq(schema.stocks.warehouseId, schema.warehouses.id),
      )
      .leftJoin(
        schema.locations,
        eq(schema.stocks.locationId, schema.locations.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return orderBy ? query.orderBy(...orderBy) : query;
  }

  // 在庫照会(商品名・倉庫名・ロケーション名を結合して返す)
  async findCurrentStocks(searchParams: GetStocksQuery, sort: SortQuery = {}) {
    return await this.buildStockListQuery(searchParams, sort);
  }

  async findCurrentStocksPage(
    searchParams: GetStocksQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    return await this.buildStockListQuery(searchParams, sort)
      .limit(params.limit)
      .offset(toOffset(params));
  }

  async countCurrentStocks(searchParams: GetStocksQuery): Promise<number> {
    const conditions = this.buildStockConditions(searchParams);
    const result = await this.db
      .select({ value: count() })
      .from(schema.stocks)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return result[0]?.value || 0;
  }

  // 出庫: ロケーションに紐づく在庫(残数>0)一覧。1ロケーション=1品目運用のため通常1件に絞られる
  async findAvailableStocksAtLocation(locationId: string) {
    return await this.db
      .select()
      .from(schema.stocks)
      .where(
        and(eq(schema.stocks.locationId, locationId), gt(schema.stocks.quantity, 0)),
      );
  }

  // バルク出庫プラン用: 品目1件について、指定倉庫種別(INTERNAL/EXTERNAL)の在庫があるロケーションを
  // 在庫が多い順に返す(1ロケーション=1品目運用が前提だが、ロット/品質区分違いで複数行になり得るため
  // フラットな行のまま返し、呼び出し元が「合算して充足できるか」「候補ロケーションが実質1つに絞れるか」を判定する)
  async findAvailableStocksForItem(
    itemId: string,
    warehouseType: "INTERNAL" | "EXTERNAL",
  ): Promise<
    Array<{
      locationId: string;
      warehouseId: string;
      lotNumber: string;
      qualityStatus: string;
      quantity: number;
    }>
  > {
    return await this.db
      .select({
        locationId: schema.stocks.locationId,
        warehouseId: schema.stocks.warehouseId,
        lotNumber: schema.stocks.lotNumber,
        qualityStatus: schema.stocks.qualityStatus,
        quantity: schema.stocks.quantity,
      })
      .from(schema.stocks)
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.stocks.warehouseId))
      .where(
        and(
          eq(schema.stocks.itemId, itemId),
          gt(schema.stocks.quantity, 0),
          eq(schema.warehouses.warehouseType, warehouseType),
        ),
      )
      .orderBy(desc(schema.stocks.quantity));
  }

  async findStockById(id: string) {
    const res = await this.db
      .select()
      .from(schema.stocks)
      .where(eq(schema.stocks.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findStockByKey(key: StockKey) {
    const res = await this.db
      .select()
      .from(schema.stocks)
      .where(
        and(
          eq(schema.stocks.itemId, key.itemId),
          eq(schema.stocks.warehouseId, key.warehouseId),
          eq(schema.stocks.locationId, key.locationId),
          eq(schema.stocks.lotNumber, key.lotNumber),
          eq(schema.stocks.accountCode, key.accountCode),
          eq(schema.stocks.qualityStatus, key.qualityStatus),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  // 入庫: find-or-create + 数量加算(複合UNIQUE INDEXへのON CONFLICTで原子的に処理)
  async increaseQuantity(key: StockKey, delta: number, now: Date) {
    await this.db
      .insert(schema.stocks)
      .values({
        id: crypto.randomUUID(),
        itemId: key.itemId,
        warehouseId: key.warehouseId,
        locationId: key.locationId,
        lotNumber: key.lotNumber,
        accountCode: key.accountCode,
        qualityStatus: key.qualityStatus,
        quantity: delta,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.stocks.itemId,
          schema.stocks.warehouseId,
          schema.stocks.locationId,
          schema.stocks.lotNumber,
          schema.stocks.accountCode,
          schema.stocks.qualityStatus,
        ],
        set: {
          quantity: sql`${schema.stocks.quantity} + ${delta}`,
          updatedAt: now,
        },
      });
  }

  // 出庫などの減算。在庫が足りない場合は SQL のエラーにする(BUG-049)。
  // 足りるかどうかは、呼び出し元(StocksService)が書き込む前に読み取って確かめ、利用者向けの理由を返す。
  // ここは、確かめた後に他の処理が同じ在庫を減らしていた場合の最後の砦で、エラーにすることで batch ごと取り消す
  // (以前は0件更新の結果で判断していたため、複数の明細のうち途中の明細が足りないと、前の明細の分だけ減ったまま残っていた)。
  // SQLite の UPDATE の中でエラーを起こす方法が他に無いため、json() に JSON ではない文字列を渡してエラーにしている
  async decreaseQuantityOrFail(stockId: string, delta: number, now: Date): Promise<void> {
    await this.db
      .update(schema.stocks)
      .set({
        quantity: sql`CASE WHEN ${schema.stocks.quantity} >= ${delta} THEN ${schema.stocks.quantity} - ${delta} ELSE json('在庫不足') END`,
        updatedAt: now,
      })
      .where(eq(schema.stocks.id, stockId));
  }

  async insertTransaction(row: {
    id: string;
    itemId: string;
    warehouseId: string;
    locationId: string;
    lotNumber: string;
    qualityStatus: string;
    quantity: number;
    type: string;
    refId: string | null;
    qrCodeKey?: string | null;
    memo?: string | null;
    createdBy: string;
    createdAt: Date;
  }) {
    await this.db.insert(schema.stockTransactions).values(row);
  }
}
