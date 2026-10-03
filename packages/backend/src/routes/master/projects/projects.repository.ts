import { drizzle } from "drizzle-orm/d1";
import { eq, and, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { GetProjectsQuery } from "./projects.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const PROJECTS_SORT_COLUMNS = {
  id: schema.projects.id,
  name: schema.projects.name,
  status: schema.projects.status,
  startDate: schema.projects.startDate,
  endDate: schema.projects.endDate,
};

export type ProjectRecord = typeof schema.projects.$inferSelect;
export type NewProjectRecord = typeof schema.projects.$inferInsert;

export class ProjectsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): ProjectsRepository {
    const repo: ProjectsRepository = Object.create(ProjectsRepository.prototype);
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(query: GetProjectsQuery) {
    const conditions = [];
    if (query.id) conditions.push(containsText(schema.projects.id, query.id));
    if (query.name) conditions.push(containsText(schema.projects.name, query.name));
    if (query.status && query.status !== "all")
      conditions.push(eq(schema.projects.status, query.status));
    return conditions;
  }

  async findMany(query: GetProjectsQuery, sort: SortQuery = {}): Promise<ProjectRecord[]> {
    const orderBy = buildOrderBy(sort, PROJECTS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.projects)
      .where(combineConditions(this.buildConditions(query)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findManyPage(
    query: GetProjectsQuery,
    params: PaginationParams,
    sort: SortQuery = {},
  ): Promise<ProjectRecord[]> {
    const orderBy = buildOrderBy(sort, PROJECTS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.projects)
      .where(combineConditions(this.buildConditions(query)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(params.limit).offset(toOffset(params));
  }

  async countMany(query: GetProjectsQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.projects)
      .where(combineConditions(this.buildConditions(query)));
    return result[0]?.value || 0;
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const result = await this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);
    return result[0] || null;
  }

  async insert(record: NewProjectRecord): Promise<void> {
    await this.db.insert(schema.projects).values(record);
  }

  async update(id: string, record: Partial<NewProjectRecord>): Promise<void> {
    await this.db.update(schema.projects).set(record).where(eq(schema.projects.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.projects).where(eq(schema.projects.id, id));
  }

  async bulkUpsert(
    records: Array<{
      id: string;
      name: string;
      memo: string | null;
      startDate: Date | null;
      endDate: Date | null;
      status: string;
      opId: string;
      now: Date;
    }>,
  ): Promise<number> {
    let count = 0;
    for (const item of records) {
      await this.db
        .insert(schema.projects)
        .values({
          id: item.id,
          name: item.name,
          memo: item.memo,
          startDate: item.startDate,
          endDate: item.endDate,
          status: item.status,
          createdBy: item.opId,
          createdAt: item.now,
          updatedBy: item.opId,
          updatedAt: item.now,
        })
        .onConflictDoUpdate({
          target: schema.projects.id,
          set: {
            name: item.name,
            memo: item.memo,
            startDate: item.startDate,
            endDate: item.endDate,
            status: item.status,
            updatedBy: item.opId,
            updatedAt: item.now,
          },
        });
      count++;
    }
    return count;
  }
}
