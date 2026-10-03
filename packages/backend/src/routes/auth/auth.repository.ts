import { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, lte, or, isNull, gte } from "drizzle-orm";
import * as schema from "../../db/schema";

export class AuthRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async findUserByEmail(email: string) {
    return await this.db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });
  }

  async findUserByEmployeeNumber(employeeNumber: string) {
    return await this.db.query.users.findFirst({
      where: eq(schema.users.employeeNumber, employeeNumber),
    });
  }

  // BUG-021: 古い形(固定ソルト)のハッシュ値を、ログイン成功時に新しい形へ書き換える(利用者の変更ではないため更新日時は変えない)
  async updatePasswordHash(userId: string, passwordHash: string) {
    await this.db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
  }

  // BUG-022: ログインの失敗が続いたアカウントのロック(無効化)。ロールは外さない(ユーザー管理で「有効」に戻せば元どおり使える)
  async deactivateUser(userId: string, now: Date) {
    await this.db.update(schema.users).set({ isActive: false, updatedAt: now }).where(eq(schema.users.id, userId));
  }

  async fetchUserMatrixRelations(userId: string, now: Date) {
    return await this.db
      .select({
        userId: schema.userRoles.userId,
        roleId: schema.roles.id,
        roleName: schema.roles.name,
        departmentSurrogateId: schema.userRoles.departmentSurrogateId,
        departmentId: schema.departments.id,
        departmentName: schema.departments.name,
      })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .leftJoin(
        schema.departments,
        and(
          eq(
            schema.userRoles.departmentSurrogateId,
            schema.departments.surrogateId,
          ),
          lte(schema.departments.validFrom, now),
          or(
            isNull(schema.departments.validTo),
            gte(schema.departments.validTo, now),
          ),
        ),
      )
      .where(eq(schema.userRoles.userId, userId));
  }

  async fetchRolePermissions(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ pId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
    return rows.map((r) => r.pId);
  }

  // Item0: プロフィール画面からの自己編集(Slack通知設定)
  async updateNotificationSettings(
    userId: string,
    data: { slackUserId?: string | null; notificationChannel?: string },
  ) {
    await this.db
      .update(schema.users)
      .set({
        ...(data.slackUserId !== undefined && { slackUserId: data.slackUserId }),
        ...(data.notificationChannel !== undefined && {
          notificationChannel: data.notificationChannel,
        }),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));
  }

  async findNotificationSettings(userId: string) {
    const result = await this.db
      .select({
        slackUserId: schema.users.slackUserId,
        notificationChannel: schema.users.notificationChannel,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return result[0] || null;
  }
}
