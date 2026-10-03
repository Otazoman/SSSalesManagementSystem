import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { recordWritesForBatch } from "./record-writes-for-batch";

const db = drizzle(env.DB, { schema });
const now = new Date();

// テスト用の小さなリポジトリ(書き込みの前に select する形も含める)
class UnitsRepo {
  constructor(private db: ReturnType<typeof drizzle<typeof schema>>) {}
  async insertUnit(code: string, name: string) {
    await this.db.insert(schema.units).values({ code, name, createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now });
  }
  async renameAll(name: string) {
    const rows = await this.db.select({ code: schema.units.code }).from(schema.units);
    for (const row of rows) {
      await this.db.update(schema.units).set({ name }).where(eq(schema.units.code, row.code));
    }
  }
  async count() {
    return (await this.db.select().from(schema.units)).length;
  }
}

beforeEach(async () => {
  await db.delete(schema.units);
});

describe("recordWritesForBatch(BUG-049)", () => {
  it("書き込みは commit まで反映されず、commit で1回の batch として書き込む。select はその場で実行する", async () => {
    const repo = new UnitsRepo(db);
    await repo.insertUnit("A", "変更前");
    const tx = recordWritesForBatch(repo);

    await tx.repo.insertUnit("B", "追加");
    await tx.repo.renameAll("変更後"); // 中の select は、記録前の A だけを読む
    expect(await repo.count()).toBe(1);

    await tx.commit();
    const rows = await db.select().from(schema.units);
    expect(rows.map((r) => [r.code, r.name]).sort()).toEqual([
      ["A", "変更後"],
      ["B", "追加"],
    ]);
  });

  it("途中の書き込みが失敗した場合は、記録した書き込みを全て取り消す", async () => {
    const repo = new UnitsRepo(db);
    await repo.insertUnit("A", "既存");
    const tx = recordWritesForBatch(repo);
    await tx.repo.insertUnit("B", "追加");
    await tx.repo.insertUnit("A", "重複"); // 主キーの重複で失敗する

    await expect(tx.commit()).rejects.toThrow();
    expect((await db.select().from(schema.units)).map((r) => r.code)).toEqual(["A"]);
  });

  it("元のリポジトリの書き込みは、記録されずにその場で実行される", async () => {
    const repo = new UnitsRepo(db);
    recordWritesForBatch(repo);
    await repo.insertUnit("A", "直接");
    expect(await repo.count()).toBe(1);
  });
});

describe("recordWritesForBatch: リポジトリの中の batch", () => {
  class BatchRepo {
    constructor(private db: ReturnType<typeof drizzle<typeof schema>>) {}
    async replaceAll(codes: string[]) {
      await this.db.batch([
        this.db.delete(schema.units),
        ...codes.map((code) =>
          this.db.insert(schema.units).values({ code, name: code, createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now }),
        ),
      ] as any);
    }
  }

  it("中の batch も記録し、commit まで実行しない", async () => {
    await new UnitsRepo(db).insertUnit("OLD", "既存");
    const tx = recordWritesForBatch(new BatchRepo(db));
    await tx.repo.replaceAll(["X", "Y"]);
    expect((await db.select().from(schema.units)).map((r) => r.code)).toEqual(["OLD"]);
    await tx.commit();
    expect((await db.select().from(schema.units)).map((r) => r.code).sort()).toEqual(["X", "Y"]);
  });
});
