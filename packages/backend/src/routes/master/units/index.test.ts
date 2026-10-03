import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { unitsRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 * ここで固定した「ステータスコード・レスポンスJSONの中身」は、HttpErrorベースへの
 * 書き換え後も一切変化しないことをこのテストで保証する(docs/target-architecture.md 15章の
 * 完了条件「既存APIレスポンス形状・ステータスコードが変化しないこと」に対応)。
 */

const db = drizzle(env.DB, { schema });

async function seedUser() {
  const now = new Date();
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  await db.delete(schema.unitConversions);
  await db.delete(schema.units);
  await db.delete(schema.users);
  await seedUser();
});

async function postJson(path: string, body: unknown) {
    const ctx = createExecutionContext();
  const _res = await unitsRouter.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

describe("POST /register", () => {
  it("正常登録は200・successメッセージを返す", async () => {
    const res = await postJson("/register", { code: "BOX", name: "箱" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "単位を登録しました",
      status: "active",
    });
  });

  it("重複コード登録は400・固定メッセージを返す", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
    const res = await postJson("/register", { code: "BOX", name: "箱2" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "重複した単位コード、または不正な入力です",
    });
  });
});

describe("PUT /:code", () => {
  it("存在しないコードの更新は404・固定メッセージを返す", async () => {
        const ctx = createExecutionContext();
    const res = await unitsRouter.request(
      "/NOPE",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "存在しない単位", status: "active" }),
      },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の単位が見つかりません",
    });
  });

  it("存在するコードの更新は200・successメッセージを返す", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
        const ctx = createExecutionContext();
    const res = await unitsRouter.request(
      "/BOX",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "箱(改)", status: "active" }),
      },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "単位を更新しました" });
  });
});

describe("DELETE /:code", () => {
  it("無効化前の単位の削除は400・固定メッセージを返す", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
        const ctx = createExecutionContext();
    const res = await unitsRouter.request("/BOX", { method: "DELETE" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態の単位のみ物理削除できます",
    });
  });

  it("他テーブルから参照されている単位の削除は400・固定メッセージを返す", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
    await postJson("/register", { code: "PCS", name: "個" });
    const now = new Date();
    await db.insert(schema.unitConversions).values({
      id: "conv-1",
      fromUnitCode: "BOX",
      toUnitCode: "PCS",
      conversionFactor: 10,
      createdBy: "user-001",
      createdAt: now,
      updatedBy: "user-001",
      updatedAt: now,
    });
    const suspendCtx = createExecutionContext();
    await unitsRouter.request("/BOX/suspend", { method: "POST" }, env, suspendCtx);
    await waitOnExecutionContext(suspendCtx);

        const ctx = createExecutionContext();
    const res = await unitsRouter.request("/BOX", { method: "DELETE" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message:
        "この単位は、すでに品目マスタ等で参照されているため削除できません",
    });
  });

  it("無効化済みで参照されていない単位の削除は200・successメッセージを返す", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
    const suspendCtx = createExecutionContext();
    await unitsRouter.request("/BOX/suspend", { method: "POST" }, env, suspendCtx);
    await waitOnExecutionContext(suspendCtx);
        const ctx = createExecutionContext();
    const res = await unitsRouter.request("/BOX", { method: "DELETE" }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "単位を削除しました" });
  });
});

describe("POST /csv/import", () => {
  it("ファイル未添付は400・固定メッセージを返す", async () => {
    const formData = new FormData();
        const ctx = createExecutionContext();
    const res = await unitsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "ファイルがありません" });
  });

  it("ヘッダー不正は400・固定メッセージを返す", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(["foo,bar\n1,2"], "units.csv", { type: "text/csv" }),
    );
        const ctx = createExecutionContext();
    const res = await unitsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "CSVのヘッダーに 'code' または 'name' が見つかりません",
    });
  });

  it("正常なCSVは200・件数入りメッセージを返す", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(["code,name\nBOX,箱"], "units.csv", { type: "text/csv" }),
    );
        const ctx = createExecutionContext();
    const res = await unitsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env, ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "CSVから 1 件の単位データを安全に同期しました",
    });
  });

  // BUG-002: CSV で取り込んだ単位が、承認機能が無効でも仮登録(temporary)になっていた
  async function importCsv(content: string) {
    const formData = new FormData();
    formData.set("file", new File([content], "units.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const res = await unitsRouter.request("/bulk-register", { method: "POST", body: formData }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  }
  async function statusOf(code: string) {
    const rows = await db.select().from(schema.units);
    return rows.find((u) => u.code === code)?.status;
  }

  it("status 列が無い場合、新規の単位は画面の登録と同じ状態(承認機能が無効なら有効)で登録する", async () => {
    await importCsv("code,name\nBOX,箱");
    expect(await statusOf("BOX")).toBe("active");
  });

  it("status 列があれば、その状態で登録・更新する(不正な値は無視する)", async () => {
    await importCsv("code,name,status\nBOX,箱,suspended\nKG,キログラム,unknown");
    expect(await statusOf("BOX")).toBe("suspended");
    expect(await statusOf("KG")).toBe("active");

    await importCsv("code,name,status\nBOX,箱,active");
    expect(await statusOf("BOX")).toBe("active");
  });

  it("既存の単位は、status が空欄なら今の状態のままにする", async () => {
    await importCsv("code,name,status\nBOX,箱,suspended");
    await importCsv("code,name,status\nBOX,ハコ,");
    expect(await statusOf("BOX")).toBe("suspended");
  });
});

describe("GET / と GET /csv/download", () => {
  it("一覧取得は登録済みデータをJSON配列で返す", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
        const ctx = createExecutionContext();
    const res = await unitsRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ code: string; name: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ code: "BOX", name: "箱" });
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
    await postJson("/register", { code: "PCS", name: "個" });
    await postJson("/register", { code: "SET", name: "セット" });

        const ctx = createExecutionContext();
    const res = await unitsRouter.request("/?page=1&limit=2", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ code: string; name: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it("sortBy=code&sortOrder=descの場合はcodeの降順で返す(page/limit未指定)", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
    await postJson("/register", { code: "PCS", name: "個" });
        const ctx = createExecutionContext();
    const res = await unitsRouter.request("/?sortBy=code&sortOrder=desc", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ code: string }>;
    expect(body.map((u) => u.code)).toEqual(["PCS", "BOX"]);
  });

  it("sortBy指定時はpage/limit指定と組み合わせても並び替わる", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
    await postJson("/register", { code: "PCS", name: "個" });
        const ctx = createExecutionContext();
    const res = await unitsRouter.request(
      "/?page=1&limit=10&sortBy=code&sortOrder=desc",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ code: string }> };
    expect(body.data.map((u) => u.code)).toEqual(["PCS", "BOX"]);
  });

  it("許可されていないsortByは無視される", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
        const ctx = createExecutionContext();
    const res = await unitsRouter.request("/?sortBy=status", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ code: string }>;
    expect(body.some((u) => u.code === "BOX")).toBe(true);
  });

  it("CSVダウンロードはBOM付きCSVを返す", async () => {
    await postJson("/register", { code: "BOX", name: "箱" });
        const ctx = createExecutionContext();
    const res = await unitsRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8",
    );
    // res.text()はTextDecoderの仕様でBOMを読み飛ばすため、生バイト列で検証する
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const contentAfterBom = new TextDecoder().decode(bytes.slice(3));
    expect(contentAfterBom).toBe('code,name\n"BOX","箱"');
  });
});
