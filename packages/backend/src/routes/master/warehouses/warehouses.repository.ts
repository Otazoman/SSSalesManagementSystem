import { drizzle } from "drizzle-orm/d1";
import { eq, and, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { WarehouseUpsertInput } from "./warehouses.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

type WarehouseSearchParams = { id?: string; name?: string; status?: string };

// ヘッダクリックソート(追加要望D)の許可カラム
const WAREHOUSES_SORT_COLUMNS = {
  id: schema.warehouses.id,
  name: schema.warehouses.name,
  status: schema.warehouses.status,
};

export class WarehousesRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db, "SYSTEM_USER");
  }

  private buildConditions(searchParams: WarehouseSearchParams) {
    const conditions = [];
    if (searchParams.id)
      conditions.push(containsText(schema.warehouses.id, searchParams.id));
    if (searchParams.name)
      conditions.push(containsText(schema.warehouses.name, searchParams.name));
    if (searchParams.status && searchParams.status !== "all")
      conditions.push(eq(schema.warehouses.status, searchParams.status));
    return conditions;
  }

  private async attachRelations(rawWarehouses: any[]) {
    return await Promise.all(
      rawWarehouses.map(async (w: any) => {
        const days = await this.db
          .select()
          .from(schema.warehouseAvailableDays)
          .where(eq(schema.warehouseAvailableDays.warehouseId, w.id))
          .catch(() => []);

        const atts = await this.db
          .select()
          .from(schema.warehouseAttachments)
          .where(eq(schema.warehouseAttachments.warehouseId, w.id))
          .catch(() => []);

        return { ...w, availableDays: days || [], attachments: atts || [] };
      }),
    );
  }

  // 一覧取得
  async findWarehouses(searchParams: WarehouseSearchParams, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, WAREHOUSES_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.warehouses)
      .where(combineConditions(this.buildConditions(searchParams)));
    const rawWarehouses = await (orderBy ? base.orderBy(...orderBy) : base);

    return await this.attachRelations(rawWarehouses);
  }

  async findWarehousesPage(
    searchParams: WarehouseSearchParams,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, WAREHOUSES_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.warehouses)
      .where(combineConditions(this.buildConditions(searchParams)));
    const query = orderBy ? base.orderBy(...orderBy) : base;
    const rawWarehouses = await query.limit(params.limit).offset(toOffset(params));

    return await this.attachRelations(rawWarehouses);
  }

  async countWarehouses(searchParams: WarehouseSearchParams): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.warehouses)
      .where(combineConditions(this.buildConditions(searchParams)));
    return result[0]?.value || 0;
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): WarehousesRepository {
    const repo = Object.create(WarehousesRepository.prototype) as WarehousesRepository;
    repo.db = db;
    return repo;
  }

  async updateStatus(
    id: string,
    status: string,
    opId: string,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(schema.warehouses)
      .set({ status, updatedBy: opId, updatedAt: now })
      .where(eq(schema.warehouses.id, id));
  }

  // IDで1件取得
  async findById(id: string) {
    const res = await this.db
      .select()
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, id))
      .limit(1);
    return res[0] || null;
  }

  // 添付ファイル一覧取得
  async findAttachmentsByWarehouseId(warehouseId: string) {
    return await this.db
      .select()
      .from(schema.warehouseAttachments)
      .where(eq(schema.warehouseAttachments.warehouseId, warehouseId));
  }

  // ➕ 指定した倉庫に属する添付ファイルを1件取得(他倉庫のファイルは取得できない)
  async findAttachmentByIdAndWarehouseId(
    attachmentId: string,
    warehouseId: string,
  ) {
    const res = await this.db
      .select()
      .from(schema.warehouseAttachments)
      .where(
        and(
          eq(schema.warehouseAttachments.id, attachmentId),
          eq(schema.warehouseAttachments.warehouseId, warehouseId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  // 個別登録
  // マスタコード自動採番: 呼び出し元(WarehousesService.registerWarehouse)がidを解決済みの前提のため、
  // ここではidをstring必須として受ける
  async createWarehouse(data: WarehouseUpsertInput & { id: string }, operatorId: string) {
    const now = new Date();
    const warehouseInsert = {
      id: data.id,
      name: data.name,
      postalCode: data.postalCode || null,
      address: data.address || null,
      phoneNumber: data.phoneNumber || null,
      faxNumber: data.faxNumber || null,
      email: data.email || null,
      businessStartTime: data.businessStartTime || null,
      businessEndTime: data.businessEndTime || null,
      storageRestrictions: data.storageRestrictions || null,
      warehouseType: data.warehouseType || "INTERNAL",
      status: data.status || "temporary",
      memo: data.memo || null,
      createdBy: operatorId,
      createdAt: now,
      updatedBy: operatorId,
      updatedAt: now,
    };

    const batchQueries: [any, ...any[]] = [
      this.db.insert(schema.warehouses).values(warehouseInsert),
    ];

    if (data.availableDays && Array.isArray(data.availableDays)) {
      data.availableDays.forEach((day: any, index: number) => {
        const dayInsert = {
          id: `${data.id}_DAY_${Date.now()}_${index}`,
          warehouseId: data.id,
          availabledayOfWeek:
            day.availabledayOfWeek || day.availableDayOfWeek || "MON",
          timeSlotMemo: day.timeSlotMemo || null,
          createdBy: operatorId,
          createdAt: now,
          updatedBy: operatorId,
          updatedAt: now,
        };
        batchQueries.push(
          this.db.insert(schema.warehouseAvailableDays).values(dayInsert),
        );
      });
    }

    await this.db.batch(batchQueries);

    if (data.attachments && Array.isArray(data.attachments)) {
      for (const att of data.attachments) {
        await this.db.insert(schema.warehouseAttachments).values({
          id:
            att.id ||
            `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          warehouseId: data.id,
          fileName: att.fileName,
          storageType: att.storageType || "R2",
          attachmentR2Path: att.attachmentR2Path || null,
          externalUrl: att.externalUrl || null,
          fileType: att.fileType || "OTHER",
          uploadedById: operatorId,
          uploadedAt: now,
        });
      }
    }
  }

  // 個別更新
  async updateWarehouse(
    id: string,
    data: WarehouseUpsertInput,
    operatorId: string,
  ) {
    const now = new Date();
    const warehouseUpdate = {
      name: data.name,
      postalCode: data.postalCode || null,
      address: data.address || null,
      phoneNumber: data.phoneNumber || null,
      faxNumber: data.faxNumber || null,
      email: data.email || null,
      businessStartTime: data.businessStartTime || null,
      businessEndTime: data.businessEndTime || null,
      storageRestrictions: data.storageRestrictions || null,
      warehouseType: data.warehouseType || "INTERNAL",
      status: data.status || "temporary",
      memo: data.memo || null,
      updatedBy: operatorId,
      updatedAt: now,
    };

    const batchQueries: [any, ...any[]] = [
      this.db
        .update(schema.warehouses)
        .set(warehouseUpdate)
        .where(eq(schema.warehouses.id, id)),
      this.db
        .delete(schema.warehouseAvailableDays)
        .where(eq(schema.warehouseAvailableDays.warehouseId, id)),
    ];

    if (data.availableDays && Array.isArray(data.availableDays)) {
      data.availableDays.forEach((day: any, index: number) => {
        const dayInsert = {
          id: `${id}_DAY_${Date.now()}_${index}`,
          warehouseId: id,
          availabledayOfWeek:
            day.availabledayOfWeek || day.availableDayOfWeek || "MON",
          timeSlotMemo: day.timeSlotMemo || null,
          createdBy: operatorId,
          createdAt: now,
          updatedBy: operatorId,
          updatedAt: now,
        };
        batchQueries.push(
          this.db.insert(schema.warehouseAvailableDays).values(dayInsert),
        );
      });
    }

    await this.db.batch(batchQueries);

    // 添付ファイルの洗い替え
    await this.db
      .delete(schema.warehouseAttachments)
      .where(eq(schema.warehouseAttachments.warehouseId, id));

    if (data.attachments && Array.isArray(data.attachments)) {
      for (const att of data.attachments) {
        await this.db.insert(schema.warehouseAttachments).values({
          id:
            att.id ||
            `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          warehouseId: id,
          fileName: att.fileName,
          storageType: att.storageType || "R2",
          attachmentR2Path: att.attachmentR2Path || null,
          externalUrl: att.externalUrl || null,
          fileType: att.fileType || "OTHER",
          uploadedById: operatorId,
          uploadedAt: now,
        });
      }
    }
  }

  // 削除
  async deleteWarehouse(id: string) {
    await this.db.batch([
      this.db
        .delete(schema.warehouseAvailableDays)
        .where(eq(schema.warehouseAvailableDays.warehouseId, id)),
      this.db
        .delete(schema.warehouseAttachments)
        .where(eq(schema.warehouseAttachments.warehouseId, id)),
      this.db.delete(schema.warehouses).where(eq(schema.warehouses.id, id)),
    ]);
  }

  // CSV用データ取得(検索条件対応)
  async findAllForCsv(searchParams: WarehouseSearchParams) {
    return await this.db
      .select()
      .from(schema.warehouses)
      .where(combineConditions(this.buildConditions(searchParams)));
  }

  // 一括Upsert（CSV）
  async upsertWarehouseFromCsv(row: any, operatorId: string) {
    const now = new Date();
    await this.db
      .insert(schema.warehouses)
      .values({
        id: row.id,
        name: row.name,
        postalCode: row.postalCode,
        address: row.address,
        phoneNumber: row.phoneNumber,
        faxNumber: row.faxNumber,
        email: row.email || null,
        businessStartTime: row.businessStartTime,
        businessEndTime: row.businessEndTime,
        storageRestrictions: row.storageRestrictions,
        warehouseType: row.warehouseType || "INTERNAL",
        status: row.status,
        memo: row.memo,
        createdBy: operatorId,
        createdAt: now,
        updatedBy: operatorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.warehouses.id,
        set: {
          name: row.name,
          postalCode: row.postalCode,
          address: row.address,
          phoneNumber: row.phoneNumber,
          faxNumber: row.faxNumber,
          email: row.email || null,
          businessStartTime: row.businessStartTime,
          businessEndTime: row.businessEndTime,
          storageRestrictions: row.storageRestrictions,
          warehouseType: row.warehouseType || "INTERNAL",
          status: row.status,
          memo: row.memo,
          updatedBy: operatorId,
          updatedAt: now,
        },
      });
  }
}
