// src/routes/admin/users/user.repository.ts
import { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq, count, and, lte, or, isNull, gte, like, sql } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

export class UserRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async countUsers(): Promise<number> {
    const result = await this.db.select({ value: count() }).from(schema.users);
    return result[0]?.value || 0;
  }

  async findById(id: string) {
    const result = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findByEmployeeNumber(empNum: string) {
    const result = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.employeeNumber, empNum))
      .limit(1);
    return result[0] || null;
  }

  async findByActiveEmail(email: string) {
    const result = await this.db
      .select()
      .from(schema.users)
      .where(
        and(eq(schema.users.email, email), eq(schema.users.isActive, true)),
      )
      .limit(1);
    return result[0] || null;
  }

  async setupInitialAdmin(
    adminData: any,
    roleDataAdmin: any,
    roleDataWorkflowAdmin: any, // 💡 追加
    userRoleData: any,
  ) {
    return await this.db.batch([
      // 💡 admin ロールと workflow_admin ロールの両方をマスタに登録
      this.db.insert(schema.roles).values(roleDataAdmin).onConflictDoNothing(),
      this.db
        .insert(schema.roles)
        .values(roleDataWorkflowAdmin)
        .onConflictDoNothing(),
      this.db.insert(schema.users).values(adminData),
      this.db.insert(schema.userRoles).values(userRoleData),
    ]);
  }

  async fetchFilteredUsers(conditions: any[]) {
    return await this.db
      .select()
      .from(schema.users)
      .where(combineConditions(conditions));
  }

  async fetchUserMatrixRelations(now: Date) {
    return await this.db
      .select({
        userId: schema.userRoles.userId,
        roleId: schema.roles.id,
        roleName: schema.roles.name,
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
      );
  }

  async findActiveDepartmentSurrogateId(
    deptId: string,
    now: Date,
  ): Promise<string | null> {
    const activeDept = await this.db
      .select()
      .from(schema.departments)
      .where(
        and(
          eq(schema.departments.id, deptId),
          lte(schema.departments.validFrom, now),
          or(
            isNull(schema.departments.validTo),
            gte(schema.departments.validTo, now),
          ),
        ),
      )
      .limit(1);
    return activeDept[0]?.surrogateId || null;
  }

  async createUser(userData: any, relations: any[], now: Date) {
    await this.db.insert(schema.users).values(userData);
    if (relations && relations.length > 0) {
      await this.insertUserRelations(userData.id, relations, now);
    }
  }

  async insertUserRelations(userId: string, relations: any[], now: Date) {
    if (!relations || !Array.isArray(relations) || relations.length === 0)
      return;

    for (const rel of relations) {
      if (!rel || !rel.roleId) continue;

      let deptSurrogateId: string | null = null;

      // departmentIdが存在する場合のみ検索を実施（undefined対策）
      if (rel.roleId !== "admin" && rel.departmentId) {
        deptSurrogateId = await this.findActiveDepartmentSurrogateId(
          rel.departmentId,
          now,
        );
      }

      await this.db
        .insert(schema.userRoles)
        .values({
          userId,
          roleId: rel.roleId,
          departmentSurrogateId: deptSurrogateId,
        })
        .onConflictDoNothing();
    }
  }

  async updateUserProfile(
    userId: string,
    updateData: any,
    relations: any[],
    now: Date,
  ) {
    // BUG-049: ユーザーの更新と、役割(権限)の入れ替え(全削除→登録し直し)は1回の batch で書き込む。
    // 以前は1つずつ書き込んでいたため、役割を消した後に失敗すると、そのユーザーの権限が無くなっていた
    const tx = recordWritesForBatch(this);
    await tx.repo.db
      .update(schema.users)
      .set(updateData)
      .where(eq(schema.users.id, userId));
    await tx.repo.db
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));
    await tx.repo.insertUserRelations(userId, relations, now);
    await tx.commit();
  }

  async suspendUser(userId: string) {
    return await this.db.batch([
      this.db
        .update(schema.users)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.users.id, userId)),
      this.db
        .delete(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId)),
    ]);
  }

  async purgeUser(userId: string) {
    const rolesCount = await this.db
      .select({ value: count() })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));

    if ((rolesCount[0]?.value || 0) > 0) {
      throw new Error("HAS_RELATIONS_REMAINING");
    }

    await this.db
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));
    try {
      await this.db.run(
        sql`DELETE FROM user_departments WHERE user_id = ${userId}`,
      );
    } catch (_) {}
    await this.db.delete(schema.users).where(eq(schema.users.id, userId));
  }

  async updatePassword(userId: string, hashedPassword: string) {
    await this.db
      .update(schema.users)
      .set({ passwordHash: hashedPassword, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  async upsertUserForBulk(
    employeeNumber: string,
    email: string,
    name: string,
    passwordRaw: string,
    clearedUserIds: Set<string>,
    now: Date,
    // 追加要望B: CSVにSlack列がある場合のみ渡す(旧形式CSVでは undefined = 既存の値を変更しない)
    slack?: { slackUserId: string | null; notificationChannel: "email" | "slack" },
  ): Promise<string> {
    const existingUser = await this.findByEmployeeNumber(employeeNumber);
    let uid: string;

    if (existingUser) {
      uid = existingUser.id;
      await this.db
        .update(schema.users)
        .set({ email, name, updatedAt: now, ...(slack ?? {}) })
        .where(eq(schema.users.id, uid));

      if (!clearedUserIds.has(uid)) {
        await this.db
          .delete(schema.userRoles)
          .where(eq(schema.userRoles.userId, uid));
        clearedUserIds.add(uid);
      }
    } else {
      uid = crypto.randomUUID();
      const hash = await import("../../../utils/crypto").then((m) =>
        m.hashPassword(passwordRaw || "Initial1234"),
      );
      await this.db.insert(schema.users).values({
        id: uid,
        employeeNumber,
        email,
        name,
        passwordHash: hash,
        isActive: true,
        ...(slack ?? {}),
        createdAt: now,
        updatedAt: now,
      });
      clearedUserIds.add(uid);
    }
    return uid;
  }
}
