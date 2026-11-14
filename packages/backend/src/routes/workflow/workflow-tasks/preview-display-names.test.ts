import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { pickDisplayNames, resolvePreviewDisplayNames } from "./preview-display-names";

// BUG-089: 承認のプレビューの番号(取引先・品目・担当者など)の名前を、表ごとにまとめて引く

const db = drizzle(env.DB, { schema });
const now = new Date();
const audit = { createdBy: "SYSTEM", createdAt: now, updatedBy: "SYSTEM", updatedAt: now };

function countingDb() {
  const counter = { prepares: 0 };
  const d1 = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          counter.prepares += 1;
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { countedDb: drizzle(d1, { schema }), counter };
}

beforeEach(async () => {
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await db.insert(schema.partners).values([
    { id: "P-1", name: "テスト商事", ...audit },
    { id: "P-2", name: "サンプル工業", ...audit },
  ]);
  await db.insert(schema.users).values({
    id: "user-1",
    employeeNumber: "E001",
    email: "e001@example.com",
    name: "営業太郎",
    createdAt: now,
    updatedAt: now,
  });
});

describe("resolvePreviewDisplayNames(BUG-089)", () => {
  it("ヘッダー・明細・入れ子のデータの番号を集め、「種類:番号」→名前を返す", async () => {
    const previews = [
      { header: { partnerId: "P-1", salesPersonEmployeeNumber: "E001", applicantId: "user-1" }, items: [{ itemId: "X" }] },
      { partnerId: "P-2", customerId: "P-1" },
      null,
    ];
    const names = await resolvePreviewDisplayNames(db, previews);
    expect(names).toMatchObject({
      "partner:P-1": "テスト商事",
      "partner:P-2": "サンプル工業",
      "employee:E001": "営業太郎",
      "user:user-1": "営業太郎",
    });
    // 見つからない番号は入れない(画面は番号のまま出す)
    expect(names["item:X"]).toBeUndefined();

    expect(pickDisplayNames(names, [previews[1]])).toEqual({ "partner:P-1": "テスト商事", "partner:P-2": "サンプル工業" });
  });

  it("名前は表ごとに1回ずつ引く(プレビューの件数に比例しない)", async () => {
    const one = countingDb();
    await resolvePreviewDisplayNames(one.countedDb, [{ partnerId: "P-1" }]);
    const many = countingDb();
    await resolvePreviewDisplayNames(
      many.countedDb,
      Array.from({ length: 30 }, (_, i) => ({ partnerId: i % 2 ? "P-1" : "P-2" })),
    );
    expect(one.counter.prepares).toBe(1);
    expect(many.counter.prepares).toBe(1);
  });

  it("番号が無いプレビューでは問い合わせない", async () => {
    const { countedDb, counter } = countingDb();
    expect(await resolvePreviewDisplayNames(countedDb, [{ title: "件名だけ" }])).toEqual({});
    expect(counter.prepares).toBe(0);
  });
});
