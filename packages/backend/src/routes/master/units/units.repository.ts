import { drizzle } from "drizzle-orm/d1";
import { eq, inArray, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { CreateUnitInput, UpdateUnitInput } from "./units.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";

// ヘッダクリックソート(追加要望D)のパイロット実装。許可する列のみをここで宣言する
const UNITS_SORT_COLUMNS = {
  code: schema.units.code,
  name: schema.units.name,
};

export class UnitsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  /**
   * 既にDrizzle化済みのdbインスタンスから構築する(workflow-engine/target-adapters等、
   * raw D1Databaseではなくワークフロー共通の既存db(AppDb)しか持たない文脈向け)。
   */
  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): UnitsRepository {
    const repo: UnitsRepository = Object.create(UnitsRepository.prototype);
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(status?: string) {
    const conditions = [];
    if (status && status !== "all") {
      conditions.push(eq(schema.units.status, status));
    }
    return conditions;
  }

  async getAllUnits(status?: string, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, UNITS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.units)
      .where(combineConditions(this.buildConditions(status)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async getUnitsPage(
    params: PaginationParams,
    status?: string,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, UNITS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.units)
      .where(combineConditions(this.buildConditions(status)));
    const query = orderBy ? base.orderBy(...orderBy) : base;
    return await query.limit(params.limit).offset(toOffset(params));
  }

  async countUnits(status?: string): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.units)
      .where(combineConditions(this.buildConditions(status)));
    return result[0]?.value || 0;
  }

  async findUnitByCode(code: string) {
    const res = await this.db
      .select()
      .from(schema.units)
      .where(eq(schema.units.code, code))
      .limit(1);
    return res[0] || null;
  }

  async createUnit(
    input: CreateUnitInput,
    opId: string,
    now: Date,
    status: string,
  ) {
    await this.db.insert(schema.units).values({
      code: input.code,
      name: input.name,
      status,
      createdBy: opId,
      createdAt: now,
      updatedBy: opId,
      updatedAt: now,
    });
  }

  async updateStatus(code: string, status: string, opId: string, now: Date) {
    await this.db
      .update(schema.units)
      .set({ status, updatedBy: opId, updatedAt: now })
      .where(eq(schema.units.code, code));
  }

  async updateUnit(
    code: string,
    input: UpdateUnitInput,
    opId: string,
    now: Date,
  ) {
    await this.db
      .update(schema.units)
      .set({
        name: input.name,
        status: input.status,
        updatedBy: opId,
        updatedAt: now,
      })
      .where(eq(schema.units.code, code));
  }

  async deleteUnit(code: string) {
    await this.db.delete(schema.units).where(eq(schema.units.code, code));
  }

  async findExistingCodes(codes: string[]) {
    if (codes.length === 0) return new Set<string>();
    const existingRows = await this.db
      .select({ code: schema.units.code })
      .from(schema.units)
      .where(inArray(schema.units.code, codes));
    return new Set(existingRows.map((r) => r.code));
  }

  async upsertUnitFromCsv(
    row: { code: string; name: string; status: string | null },
    isExisting: boolean,
    opId: string,
    now: Date,
  ) {
    if (isExisting) {
      await this.db
        .update(schema.units)
        .set({
          name: row.name,
          // 状態は CSV で指定された時だけ変える
          ...(row.status ? { status: row.status } : {}),
          updatedBy: opId,
          updatedAt: now,
        })
        .where(eq(schema.units.code, row.code));
    } else {
      await this.db.insert(schema.units).values({
        code: row.code,
        name: row.name,
        ...(row.status ? { status: row.status } : {}),
        createdBy: opId,
        createdAt: now,
        updatedBy: opId,
        updatedAt: now,
      });
    }
  }
}
