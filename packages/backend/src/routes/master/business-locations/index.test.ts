import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { businessLocationsRouter } from "./index";

/**
 * 新規要望: 営業拠点マスタ(2026-09-23新設)。warehouses/index.test.tsと同じ方式で
 * 実HTTPリクエスト経由の挙動を固定するcharacterization test。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.businessLocations);
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

async function registerBusinessLocation(id: string, name: string) {
  return businessLocationsRouter.request(
    "/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    },
    env,
  );
}

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await registerBusinessLocation("BL1", "東京営業所");
    const res = await businessLocationsRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((w) => w.id === "BL1")).toBe(true);
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await registerBusinessLocation("BL1", "東京営業所");
    await registerBusinessLocation("BL2", "大阪営業所");
    const res = await businessLocationsRouter.request("/?page=1&limit=1", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it("id/name/statusフィルタを併用できる", async () => {
    await registerBusinessLocation("BL1", "東京営業所");
    await registerBusinessLocation("BL2", "大阪営業所");
    const res = await businessLocationsRouter.request(
      "/?name=%E6%9D%B1%E4%BA%AC",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("BL1");
  });
});

describe("POST /register", () => {
  it("コード未入力の場合、master_code_formatsの設定(既定BL+4桁)に基づき自動採番される", async () => {
    const res = await businessLocationsRouter.request(
      "/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "自動採番拠点" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^BL-\d{4}$/);
  });

  it("住所・郵便番号・電話番号・備考を保存できる", async () => {
    const res = await businessLocationsRouter.request(
      "/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "BL1",
          name: "東京営業所",
          postalCode: "100-0001",
          address: "東京都千代田区千代田1-1",
          phoneNumber: "03-1234-5678",
          memo: "本社近く",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);

    const getRes = await businessLocationsRouter.request("/", {}, env);
    const list = (await getRes.json()) as Array<{
      id: string;
      postalCode: string | null;
      address: string | null;
      phoneNumber: string | null;
      memo: string | null;
    }>;
    const created = list.find((l) => l.id === "BL1");
    expect(created?.postalCode).toBe("100-0001");
    expect(created?.address).toBe("東京都千代田区千代田1-1");
    expect(created?.phoneNumber).toBe("03-1234-5678");
    expect(created?.memo).toBe("本社近く");
  });
});

describe("PUT /:id", () => {
  it("名称・住所を更新できる", async () => {
    await registerBusinessLocation("BL1", "東京営業所");
    const res = await businessLocationsRouter.request(
      "/BL1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "東京本社", address: "新住所" }),
      },
      env,
    );
    expect(res.status).toBe(200);

    const getRes = await businessLocationsRouter.request("/", {}, env);
    const list = (await getRes.json()) as Array<{ id: string; name: string; address: string | null }>;
    const updated = list.find((l) => l.id === "BL1");
    expect(updated?.name).toBe("東京本社");
    expect(updated?.address).toBe("新住所");
  });
});

describe("POST /:id/suspend", () => {
  it("存在するIDの無効化は200・固定メッセージを返す", async () => {
    await registerBusinessLocation("BL1", "東京営業所");
    const res = await businessLocationsRouter.request(
      "/BL1/suspend",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "該当営業拠点を無効化しました",
    });

    const getRes = await businessLocationsRouter.request("/", {}, env);
    const list = (await getRes.json()) as Array<{ id: string; status: string }>;
    expect(list.find((w) => w.id === "BL1")?.status).toBe("suspended");
  });

  it("存在しないIDの無効化は404・固定メッセージを返す", async () => {
    const res = await businessLocationsRouter.request(
      "/NOPE/suspend",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の営業拠点が見つかりません",
    });
  });
});

describe("DELETE /:id", () => {
  it("suspended状態でない営業拠点は削除拒否(400)される", async () => {
    await registerBusinessLocation("BL1", "東京営業所");
    const res = await businessLocationsRouter.request(
      "/BL1",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除拒否: 無効化状態の営業拠点のみ物理削除できます",
    });
  });

  it("存在しないIDの削除は404・固定メッセージを返す", async () => {
    const res = await businessLocationsRouter.request(
      "/NOPE",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の営業拠点が見つかりません",
    });
  });

  it("suspended状態の営業拠点は削除できる", async () => {
    await registerBusinessLocation("BL1", "東京営業所");
    await businessLocationsRouter.request("/BL1/suspend", { method: "POST" }, env);
    const res = await businessLocationsRouter.request(
      "/BL1",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: "営業拠点を削除しました" });
  });
});

describe("GET /csv-download と POST /bulk-register", () => {
  it("登録済みの拠点がCSVダウンロードに出力される", async () => {
    await registerBusinessLocation("BL1", "東京営業所");
    const res = await businessLocationsRouter.request("/csv-download", {}, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"BL1"');
    expect(text).toContain("東京営業所");
  });

  it("CSVインポートで新規の拠点が作成される", async () => {
    const csvData = [
      "id,name,postalCode,address,phoneNumber,status,memo",
      "BL-CSV-1,CSVインポート拠点,,,,active,",
    ].join("\n");

    const res = await businessLocationsRouter.request(
      "/bulk-register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvData }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("1 件");

    const getRes = await businessLocationsRouter.request("/", {}, env);
    const list = (await getRes.json()) as Array<{ id: string; name: string }>;
    expect(list.some((l) => l.id === "BL-CSV-1" && l.name === "CSVインポート拠点")).toBe(true);
  });
});
