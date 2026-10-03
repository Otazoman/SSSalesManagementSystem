import { drizzle } from "drizzle-orm/d1";
import { eq, count } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";

export class PermissionsRepository {
  private db;

  constructor(env: Env) {
    this.db = drizzle(env.DB, { schema });
  }

  // 全権限マスタ取得
  async findAllPermissions() {
    return await this.db.select().from(schema.permissions);
  }

  async findPermissionsPage(params: PaginationParams) {
    return await this.db
      .select()
      .from(schema.permissions)
      .limit(params.limit)
      .offset(toOffset(params));
  }

  async countPermissions(): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.permissions);
    return result[0]?.value || 0;
  }

  // ロールに紐づく権限ID一覧の取得
  async findPermissionsByRoleId(roleId: string) {
    return await this.db
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
  }

  // 全ロール権限紐づけデータ取得（CSVエクスポート用）
  async findAllRolePermissions() {
    return await this.db
      .select({
        roleId: schema.rolePermissions.roleId,
        permissionId: schema.rolePermissions.permissionId,
      })
      .from(schema.rolePermissions);
  }

  // バッチクエリ実行
  async executeBatch(queries: any[]) {
    if (queries.length === 0) return;
    return await this.db.batch(queries as any);
  }

  // 統合クエリビルダー用ヘルパー
  buildInsertPermissionQuery(data: {
    id: string;
    resource: string;
    action: string;
    name: string;
    description: string | null;
  }) {
    return this.db.insert(schema.permissions).values(data);
  }

  // 標準の権限枠の自動作成用。既にある権限(同じID)は変更しない
  buildInsertPermissionIfMissingQuery(data: {
    id: string;
    resource: string;
    action: string;
    name: string;
    description: string | null;
  }) {
    return this.db.insert(schema.permissions).values(data).onConflictDoNothing();
  }

  buildDeleteRolePermissionsByRoleIdQuery(roleId: string) {
    return this.db
      .delete(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
  }

  buildInsertRolePermissionQuery(data: {
    roleId: string;
    permissionId: string;
  }) {
    return this.db.insert(schema.rolePermissions).values(data);
  }
}
