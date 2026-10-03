import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { accountsRouter } from "./index";
import { AccountsService } from "./accounts.service";
import type { AccountsRepository } from "./accounts.repository";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 * FK制約違反ブランチはDB側で参照チェーンを組むコストが高いため、
 * repoをモックしたサービス単体テストでDrizzleQueryError相当のエラーを再現する。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.accounts);
  await db.delete(schema.users);
  const now = new Date();
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
});

async function postJson(path: string, method: string, body: unknown) {
    const ctx = createExecutionContext();
  const _res = await accountsRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

describe("POST /register", () => {
  it("正常登録は200・固定メッセージを返す(ワークフロー未設定環境ではactiveで登録される)", async () => {
    const res = await postJson("/register", "POST", {
      code: "1000",
      name: "現金",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "科目を登録しました",
      status: "active",
    });
  });
});

describe("POST /:code/suspend", () => {
  it("存在するコードの無効化は200・固定メッセージを返す", async () => {
    await postJson("/register", "POST", { code: "1000", name: "現金" });
        const ctx = createExecutionContext();
    const res = await accountsRouter.request(
      "/1000/suspend",
      { method: "POST" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "該当科目を利用停止しました",
    });

        const ctx2 = createExecutionContext();
    const getRes = await accountsRouter.request("/", {}, env, ctx2);
    await waitOnExecutionContext(ctx2);
    const list = (await getRes.json()) as Array<{ code: string; status: string }>;
    expect(list.find((a) => a.code === "1000")?.status).toBe("suspended");
  });

  it("存在しないコードの無効化は404・固定メッセージを返す", async () => {
        const ctx = createExecutionContext();
    const res = await accountsRouter.request(
      "/NOPE/suspend",
      { method: "POST" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の科目が見つかりません",
    });
  });
});

describe("PUT /:code", () => {
  it("既存コードの更新は200・固定メッセージを返す", async () => {
    await postJson("/register", "POST", { code: "1000", name: "現金" });
    const res = await postJson("/1000", "PUT", { name: "現金(改)" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "科目を更新しました" });
  });
});

describe("DELETE /:code", () => {
  it("active状態の科目削除は400・固定メッセージを返す", async () => {
    await postJson("/register", "POST", { code: "1000", name: "現金" });
    await postJson("/1000", "PUT", { name: "現金", status: "active" });

        const ctx = createExecutionContext();
    const res = await accountsRouter.request(
      "/1000",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態の科目のみ物理削除できます",
    });
  });

  it("temporary状態の科目削除も400・無効化を先に要求する固定メッセージを返す(無効化を経由せず削除できてしまう不具合の修正)", async () => {
    await postJson("/register", "POST", { code: "1000", name: "現金" });
    await postJson("/1000", "PUT", { name: "現金", status: "temporary" });
        const ctx = createExecutionContext();
    const res = await accountsRouter.request(
      "/1000",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態の科目のみ物理削除できます",
    });
  });

  it("suspended状態の科目削除は200・固定メッセージを返す", async () => {
    await postJson("/register", "POST", { code: "1000", name: "現金" });
    await postJson("/1000", "PUT", { name: "現金", status: "suspended" });
        const ctx = createExecutionContext();
    const res = await accountsRouter.request(
      "/1000",
      { method: "DELETE" },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "科目を削除しました" });
  });
});

describe("AccountsService.deleteAccount のFK制約違反ブランチ(repoモック)", () => {
  // 元の実装は大文字小文字を区別する raw.includes("CONSTRAINT") || raw.includes("foreign") だったため、
  // 実際のD1/Drizzleのエラーメッセージ("FOREIGN KEY constraint failed")とは噛み合わず、
  // 友好的な400にならず常に500へ落ちるバグがあった(2-2でisForeignKeyConstraintError()へ統一し修正済み)。
  it("実際のD1/Drizzleのエラー形(.causeにFK制約メッセージ)でもBadRequestError(400)をthrowする", async () => {
    const fakeRepo: Partial<AccountsRepository> = {
      findByCode: vi.fn().mockResolvedValue({ code: "1000", status: "suspended" }),
      delete: vi.fn().mockRejectedValue(
        new Error("Failed query: delete from accounts where...", {
          cause: new Error("FOREIGN KEY constraint failed"),
        }),
      ),
    };
    const service = new AccountsService(fakeRepo as AccountsRepository);
    await expect(
      service.deleteAccount({ req: {} } as any, "1000"),
    ).rejects.toMatchObject({
      status: 400,
      message:
        "この科目は品目や在庫トランザクションで既に使用されているため削除できません",
    });
  });

  it("大文字小文字が異なるケースでもBadRequestError(400)をthrowする", async () => {
    const fakeRepo: Partial<AccountsRepository> = {
      findByCode: vi.fn().mockResolvedValue({ code: "1000", status: "suspended" }),
      delete: vi
        .fn()
        .mockRejectedValue(new Error("SQLITE_CONSTRAINT: foreign key mismatch")),
    };
    const service = new AccountsService(fakeRepo as AccountsRepository);
    await expect(
      service.deleteAccount({ req: {} } as any, "1000"),
    ).rejects.toMatchObject({
      status: 400,
      message:
        "この科目は品目や在庫トランザクションで既に使用されているため削除できません",
    });
  });
});

describe("GET /", () => {
  it("登録済みデータをJSON配列で返す", async () => {
    await postJson("/register", "POST", { code: "1000", name: "現金" });
        const ctx = createExecutionContext();
    const res = await accountsRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ code: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ code: "1000", name: "現金" });
  });

  it("page/limit指定時は既存の検索条件を維持したまま{data,pagination}形式で返す", async () => {
    await postJson("/register", "POST", { code: "1000", name: "現金" });
    await postJson("/register", "POST", { code: "1001", name: "普通預金" });
        const ctx = createExecutionContext();
    const res = await accountsRouter.request(
      "/?code=10&page=1&limit=1",
      {},
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ code: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});
