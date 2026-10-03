import { drizzle } from "drizzle-orm/d1";
import { eq, and, isNull, isNotNull, lte, gte, or, SQL, count } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";

// 1. テーブル直接取得用（findAll, findBySurrogateId）の型定義
export interface DepartmentRecord {
  surrogateId: string;
  id: string;
  name: string;
  parentDepartmentSurrogateId: string | null;
  memo: string | null;
  validFrom: Date | string;
  validTo: Date | string | null;
  createdBy: string;
  createdAt: Date | string;
  updatedBy: string;
  updatedAt: Date | string;
}

// 2. JOIN取得用（findDepartments）の型定義
export interface DepartmentWithParent {
  surrogateId: string;
  id: string;
  name: string;
  parentDepartmentSurrogateId: string | null;
  parentHumanId: string | null;
  memo: string | null;
  validFrom: Date | string;
  validTo: Date | string | null;
  createdBy: string;
  createdAt: Date | string;
  updatedBy: string;
  updatedAt: Date | string;
}

// 3. CSV出力用の型定義
export interface DepartmentCsvRow {
  id: string;
  name: string;
  parentHumanId: string | null;
  memo: string | null;
  validFrom: Date | string;
  validTo: Date | string | null;
}

// ヘッダクリックソート(追加要望D)の許可カラム
const DEPARTMENTS_SORT_COLUMNS = {
  id: schema.departments.id,
  name: schema.departments.name,
  validFrom: schema.departments.validFrom,
  validTo: schema.departments.validTo,
};

export class DepartmentsRepository {
  private db;

  constructor(env: Env) {
    this.db = drizzle(env.DB, { schema });
  }

  getDbInstance() {
    return this.db;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildDepartmentConditions(
    status?: string,
    filter?: string,
    targetDateParam?: string,
  ): SQL[] {
    const dateStr = targetDateParam
      ? targetDateParam.split("T")[0]
      : new Date().toLocaleDateString("sv-SE");
    const startOfTargetDate = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfTargetDate = new Date(`${dateStr}T23:59:59.999Z`);

    const conditions: SQL[] = [];

    if (filter === "active_and_future") {
      conditions.push(
        or(
          isNull(schema.departments.validTo),
          gte(schema.departments.validTo, startOfTargetDate),
        )!,
      );
    } else if (status === "active") {
      conditions.push(
        lte(schema.departments.validFrom, endOfTargetDate),
        or(
          isNull(schema.departments.validTo),
          gte(schema.departments.validTo, startOfTargetDate),
        )!,
      );
    } else if (status === "inactive") {
      conditions.push(
        isNotNull(schema.departments.validTo),
        lte(schema.departments.validTo, startOfTargetDate),
      );
    }

    return conditions;
  }

  // 条件に応じた部署一覧を取得
  async findDepartments(
    status?: string,
    filter?: string,
    targetDateParam?: string,
    sort: SortQuery = {},
  ): Promise<DepartmentWithParent[]> {
    const parentDepartments = aliasedTable(
      schema.departments,
      "parent_departments",
    );

    const conditions = this.buildDepartmentConditions(
      status,
      filter,
      targetDateParam,
    );
    const orderBy = buildOrderBy(sort, DEPARTMENTS_SORT_COLUMNS);

    const baseQuery = this.db
      .select({
        surrogateId: schema.departments.surrogateId,
        id: schema.departments.id,
        name: schema.departments.name,
        parentDepartmentSurrogateId:
          schema.departments.parentDepartmentSurrogateId,
        parentHumanId: parentDepartments.id,
        memo: schema.departments.memo,
        validFrom: schema.departments.validFrom,
        validTo: schema.departments.validTo,
        createdBy: schema.departments.createdBy,
        createdAt: schema.departments.createdAt,
        updatedBy: schema.departments.updatedBy,
        updatedAt: schema.departments.updatedAt,
      })
      .from(schema.departments)
      .leftJoin(
        parentDepartments,
        eq(
          schema.departments.parentDepartmentSurrogateId,
          parentDepartments.surrogateId,
        ),
      );

    const filtered =
      conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
    const results = await (orderBy ? filtered.orderBy(...orderBy) : filtered);

    return results as unknown as DepartmentWithParent[];
  }

  async findDepartmentsPage(
    status: string | undefined,
    filter: string | undefined,
    targetDateParam: string | undefined,
    params: PaginationParams,
    sort: SortQuery = {},
  ): Promise<DepartmentWithParent[]> {
    const parentDepartments = aliasedTable(
      schema.departments,
      "parent_departments",
    );

    const conditions = this.buildDepartmentConditions(
      status,
      filter,
      targetDateParam,
    );
    const orderBy = buildOrderBy(sort, DEPARTMENTS_SORT_COLUMNS);

    const baseQuery = this.db
      .select({
        surrogateId: schema.departments.surrogateId,
        id: schema.departments.id,
        name: schema.departments.name,
        parentDepartmentSurrogateId:
          schema.departments.parentDepartmentSurrogateId,
        parentHumanId: parentDepartments.id,
        memo: schema.departments.memo,
        validFrom: schema.departments.validFrom,
        validTo: schema.departments.validTo,
        createdBy: schema.departments.createdBy,
        createdAt: schema.departments.createdAt,
        updatedBy: schema.departments.updatedBy,
        updatedAt: schema.departments.updatedAt,
      })
      .from(schema.departments)
      .leftJoin(
        parentDepartments,
        eq(
          schema.departments.parentDepartmentSurrogateId,
          parentDepartments.surrogateId,
        ),
      );

    const filtered =
      conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
    const ordered = orderBy ? filtered.orderBy(...orderBy) : filtered;
    const results = await ordered.limit(params.limit).offset(toOffset(params));

    return results as unknown as DepartmentWithParent[];
  }

  async countDepartments(
    status: string | undefined,
    filter: string | undefined,
    targetDateParam: string | undefined,
  ): Promise<number> {
    const conditions = this.buildDepartmentConditions(
      status,
      filter,
      targetDateParam,
    );

    const baseQuery = this.db
      .select({ value: count() })
      .from(schema.departments);

    const result =
      conditions.length > 0
        ? await baseQuery.where(and(...conditions))
        : await baseQuery;

    return result[0]?.value || 0;
  }

  // 全部署取得
  async findAll(): Promise<DepartmentRecord[]> {
    const results = await this.db.select().from(schema.departments);
    return results as unknown as DepartmentRecord[];
  }

  // surrogateId指定で取得
  async findBySurrogateId(
    surrogateId: string,
  ): Promise<DepartmentRecord | null> {
    const result = await this.db
      .select()
      .from(schema.departments)
      .where(eq(schema.departments.surrogateId, surrogateId))
      .limit(1);

    const row = result[0];
    return row ? (row as unknown as DepartmentRecord) : null;
  }

  // 新規挿入
  async insertDepartment(data: {
    surrogateId: string;
    id: string;
    name: string;
    parentDepartmentSurrogateId: string | null;
    memo: string | null;
    validFrom: Date;
    validTo: Date | null;
    createdBy: string;
    createdAt: Date;
    updatedBy: string;
    updatedAt: Date;
  }) {
    return await this.db.insert(schema.departments).values(data as any);
  }

  // 更新
  async updateDepartment(
    surrogateId: string,
    data: {
      id?: string;
      name?: string;
      parentDepartmentSurrogateId?: string | null;
      memo?: string | null;
      validFrom?: Date;
      validTo?: Date | null;
      updatedBy: string;
      updatedAt: Date;
    },
  ) {
    return await this.db
      .update(schema.departments)
      .set(data as any)
      .where(eq(schema.departments.surrogateId, surrogateId));
  }

  // CSVダウンロード用データ取得
  async findForCsvExport(
    status?: string,
    filter?: string,
    targetDateParam?: string,
  ): Promise<DepartmentCsvRow[]> {
    const parentDepartments = aliasedTable(
      schema.departments,
      "parent_departments",
    );

    const conditions = this.buildDepartmentConditions(
      status,
      filter,
      targetDateParam,
    );

    const baseQuery = this.db
      .select({
        id: schema.departments.id,
        name: schema.departments.name,
        parentHumanId: parentDepartments.id,
        memo: schema.departments.memo,
        validFrom: schema.departments.validFrom,
        validTo: schema.departments.validTo,
      })
      .from(schema.departments)
      .leftJoin(
        parentDepartments,
        eq(
          schema.departments.parentDepartmentSurrogateId,
          parentDepartments.surrogateId,
        ),
      );

    const results =
      conditions.length > 0
        ? await baseQuery.where(and(...conditions))
        : await baseQuery;

    return results as unknown as DepartmentCsvRow[];
  }
}
