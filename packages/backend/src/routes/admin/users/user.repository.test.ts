import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { UserRepository } from "./user.repository";

// BUG-049: ユーザーの更新と役割(権限)の入れ替えは1回の batch で書き込む
const db = drizzle(env.DB, { schema });
const now = new Date();

beforeEach(async () => {
  await db.delete(schema.userRoles);
  await db.delete(schema.users).where(eq(schema.users.id, "U-BATCH"));
  await db.insert(schema.roles).values({ id: "role-batch", name: "テスト役割", createdAt: now }).onConflictDoNothing();
  await db.insert(schema.users).values({
    id: "U-BATCH",
    employeeNumber: "EMP-BATCH",
    email: "batch@example.com",
    name: "変更前",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.userRoles).values({ userId: "U-BATCH", roleId: "role-batch", departmentSurrogateId: null });
});

describe("UserRepository.updateUserProfile(BUG-049)", () => {
  it("役割の登録が失敗した場合は、ユーザーの更新も役割の削除も行わない(権限が無くならない)", async () => {
    const repo = new UserRepository(env.DB);
    // 存在しない役割を指定して、役割の登録を外部キーの制約で失敗させる
    await expect(
      repo.updateUserProfile("U-BATCH", { name: "変更後" }, [{ roleId: "NO_SUCH_ROLE" }], now),
    ).rejects.toThrow();

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, "U-BATCH"));
    expect(user.name).toBe("変更前");
    const roles = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, "U-BATCH"));
    expect(roles.map((r) => r.roleId)).toEqual(["role-batch"]);
  });

  it("成功した場合は、ユーザーの更新と役割の入れ替えをまとめて行う", async () => {
    await db.insert(schema.roles).values({ id: "role-batch-2", name: "テスト役割2", createdAt: now }).onConflictDoNothing();
    await new UserRepository(env.DB).updateUserProfile("U-BATCH", { name: "変更後" }, [{ roleId: "role-batch-2" }], now);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, "U-BATCH"));
    expect(user.name).toBe("変更後");
    const roles = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, "U-BATCH"));
    expect(roles.map((r) => r.roleId)).toEqual(["role-batch-2"]);
  });
});
