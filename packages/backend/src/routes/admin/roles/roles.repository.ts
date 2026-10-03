import { drizzle } from "drizzle-orm/d1";
import { eq, count } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";

// ヘッダクリックソート(追加要望D)のパイロット実装。許可する列のみをここで宣言する
const ROLES_SORT_COLUMNS = {
  id: schema.roles.id,
  name: schema.roles.name,
  description: schema.roles.description,
};

export class RolesRepository {
  private db;

  constructor(env: Env) {
    this.db = drizzle(env.DB, { schema });
  }

  // 全ロール取得
  async findAll(sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, ROLES_SORT_COLUMNS);
    const base = this.db.select().from(schema.roles);
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findPage(params: PaginationParams, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, ROLES_SORT_COLUMNS);
    const base = this.db.select().from(schema.roles);
    const query = orderBy ? base.orderBy(...orderBy) : base;
    return await query.limit(params.limit).offset(toOffset(params));
  }

  async countAll(): Promise<number> {
    const result = await this.db.select({ value: count() }).from(schema.roles);
    return result[0]?.value || 0;
  }

  // ID指定で取得
  async findById(id: string) {
    const result = await this.db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.id, id))
      .limit(1);
    return result[0] || null;
  }

  // 新規挿入
  async insertRole(data: {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
  }) {
    return await this.db.insert(schema.roles).values(data);
  }

  // Upsert (新規挿入 または 重複時更新)
  async upsertRole(data: {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
  }) {
    return await this.db
      .insert(schema.roles)
      .values(data)
      .onConflictDoUpdate({
        target: schema.roles.id,
        set: {
          name: data.name,
          description: data.description,
        },
      });
  }

  // 更新
  async updateRole(
    id: string,
    data: {
      name: string;
      description: string | null;
    },
  ) {
    return await this.db
      .update(schema.roles)
      .set(data)
      .where(eq(schema.roles.id, id));
  }

  // 削除
  async deleteRole(id: string) {
    return await this.db.delete(schema.roles).where(eq(schema.roles.id, id));
  }
}
