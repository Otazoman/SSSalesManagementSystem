import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { journalPostingRulesRouter } from "./index";

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.journalPostingPatterns);
  await db.delete(schema.journalPostingRules);
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

  await db.insert(schema.accounts).values([
    { code: "1181", name: "仮払消費税", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { code: "2101", name: "買掛金", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { code: "5101", name: "仕入高", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { code: "1151", name: "前渡金", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { code: "1111", name: "現金預金", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    { code: "9999", name: "廃止科目", status: "suspended", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
  ]);
});

async function putRule(eventType: string, body: Record<string, unknown>) {
  const ctx = createExecutionContext();
  const res = await journalPostingRulesRouter.request(
    `/${eventType}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("GET /", () => {
  it("未設定でも固定6件(PREPAYMENT/PURCHASE/ADVANCE_RECEIPT/SALES/RECEIPT/DISBURSEMENT)を返し、既定でenabled=falseになる", async () => {
    const ctx = createExecutionContext();
    const res = await journalPostingRulesRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toHaveLength(6);
    expect(body.map((r) => r.eventType).sort()).toEqual(
      ["ADVANCE_RECEIPT", "DISBURSEMENT", "PREPAYMENT", "PURCHASE", "RECEIPT", "SALES"].sort(),
    );
    expect(body.every((r) => r.enabled === false)).toBe(true);
  });

  it("更新済みの行はその内容を反映して返す", async () => {
    await putRule("PURCHASE", {
      variableAccountPriority: "ITEM_MASTER_FIRST",
      variableAccountFallbackCode: "5101",
      payableAccountCode: "2101",
      taxAccountCode: "1181",
      enabled: true,
    });

    const ctx = createExecutionContext();
    const res = await journalPostingRulesRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const body = (await res.json()) as any[];
    const purchase = body.find((r) => r.eventType === "PURCHASE");
    expect(purchase.enabled).toBe(true);
    expect(purchase.payableAccountCode).toBe("2101");
    // 役割別の科目から、組ごとの借方・貸方が組み立てられて保存・返却される
    expect(purchase.patterns.find((p: any) => p.documentType === "PURCHASE" && p.lineKind === "BODY")).toEqual({
      documentType: "PURCHASE",
      lineKind: "BODY",
      debitFromItem: true,
      debitAccountCode: "5101",
      creditFromItem: false,
      creditAccountCode: "2101",
    });
    expect(purchase.patterns.find((p: any) => p.documentType === "RETURN" && p.lineKind === "TAX")).toMatchObject({
      debitAccountCode: "2101",
      creditAccountCode: "1181",
    });
  });

  it("未設定の事象も、組(区分×本体・消費税・充当)の一覧を科目なしで返す", async () => {
    const ctx = createExecutionContext();
    const res = await journalPostingRulesRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const body = (await res.json()) as any[];
    const sales = body.find((r) => r.eventType === "SALES");
    expect(sales.patterns.map((p: any) => `${p.documentType}:${p.lineKind}`)).toEqual([
      "SALE:BODY",
      "SALE:TAX",
      "SALE:ADVANCE",
      "RETURN:BODY",
      "RETURN:TAX",
      "DISCOUNT:BODY",
      "DISCOUNT:TAX",
      "CORRECTION:BODY",
      "CORRECTION:TAX",
    ]);
    expect(sales.patterns.every((p: any) => p.debitAccountCode === null && p.creditAccountCode === null)).toBe(true);
    expect(body.find((r) => r.eventType === "RECEIPT").patterns).toHaveLength(1);
  });
});

describe("PUT /:eventType(組ごとの借方・貸方)", () => {
  const purchaseBase = {
    variableAccountFallbackCode: "5101",
    payableAccountCode: "2101",
    taxAccountCode: "1181",
    enabled: true,
  };

  it("指定した組だけ上書きし、指定しない組は役割別の科目から組み立てる", async () => {
    const res = await putRule("PURCHASE", {
      ...purchaseBase,
      // 値引だけ、品目の科目ではなく仕入値引(ここでは前渡金の科目で代用)にする
      patterns: [
        { documentType: "DISCOUNT", lineKind: "BODY", debitFromItem: false, debitAccountCode: "2101", creditFromItem: false, creditAccountCode: "1151" },
      ],
    });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.journalPostingPatterns)
      .where(eq(schema.journalPostingPatterns.eventType, "PURCHASE"));
    expect(rows).toHaveLength(9);
    expect(rows.find((r) => r.documentType === "DISCOUNT" && r.lineKind === "BODY")).toMatchObject({
      creditFromItem: false,
      creditAccountCode: "1151",
    });
    expect(rows.find((r) => r.documentType === "RETURN" && r.lineKind === "BODY")).toMatchObject({
      debitAccountCode: "2101",
      creditFromItem: true,
      creditAccountCode: "5101",
    });
  });

  it("有効化する場合、本体・消費税の組は借方・貸方の両方が必要(充当の組は任意)", async () => {
    const res = await putRule("PURCHASE", {
      ...purchaseBase,
      patterns: [
        { documentType: "RETURN", lineKind: "TAX", debitAccountCode: "2101", creditAccountCode: null },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("仕入計上の「返品・消費税」");
  });

  it("その事象に無い組を指定すると400になる", async () => {
    const res = await putRule("RECEIPT", {
      enabled: false,
      patterns: [{ documentType: "SALE", lineKind: "BODY", debitAccountCode: "1111", creditAccountCode: "2101" }],
    });
    expect(res.status).toBe(400);
  });

  it("組の科目に存在しないコードを指定すると400になる(enabled=true時)", async () => {
    const res = await putRule("RECEIPT", {
      enabled: true,
      patterns: [{ documentType: "DEFAULT", lineKind: "BODY", debitAccountCode: "1111", creditAccountCode: "NOT-EXIST" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("NOT-EXIST");
  });
});

describe("PUT /:eventType", () => {
  it("存在しない勘定科目コードを指定すると400になる(enabled=true時)", async () => {
    const res = await putRule("PURCHASE", {
      variableAccountFallbackCode: "5101",
      payableAccountCode: "NOT-EXIST",
      taxAccountCode: "1181",
      enabled: true,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("NOT-EXIST");
  });

  it("廃止済みの勘定科目コードを指定すると400になる(enabled=true時)", async () => {
    const res = await putRule("PURCHASE", {
      variableAccountFallbackCode: "5101",
      payableAccountCode: "9999",
      taxAccountCode: "1181",
      enabled: true,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("有効");
  });

  it("RECEIPT(入金)をenabled=trueにするには現金預金・売掛金の両方が必須", async () => {
    const res = await putRule("RECEIPT", { cashAccountCode: "1111", enabled: true });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("入金の「本体」の借方・貸方");
  });

  it("DISBURSEMENT(支払)をenabled=trueにするには買掛金・現金預金の両方が必須", async () => {
    const res = await putRule("DISBURSEMENT", { payableAccountCode: "2101", enabled: true });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("支払の「本体」の借方・貸方");
  });

  it("入金・支払は必要な科目が揃っていれば保存でき、次回のGETで反映される", async () => {
    const now = new Date();
    await db.insert(schema.accounts).values({ code: "1131", name: "売掛金", status: "active", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now });
    expect((await putRule("RECEIPT", { cashAccountCode: "1111", receivableAccountCode: "1131", enabled: true })).status).toBe(200);
    expect((await putRule("DISBURSEMENT", { payableAccountCode: "2101", cashAccountCode: "1111", enabled: true })).status).toBe(200);

    const ctx = createExecutionContext();
    const res = await journalPostingRulesRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const body = (await res.json()) as any[];
    expect(body.find((r) => r.eventType === "RECEIPT")).toMatchObject({ enabled: true, receivableAccountCode: "1131" });
    expect(body.find((r) => r.eventType === "DISBURSEMENT")).toMatchObject({ enabled: true, payableAccountCode: "2101" });
  });

  it("PURCHASEをenabled=trueにするには買掛金科目が必須", async () => {
    const res = await putRule("PURCHASE", {
      variableAccountFallbackCode: "5101",
      enabled: true,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("仕入計上の「仕入・本体」の借方・貸方");
  });

  it("PURCHASEをenabled=trueにするには既定科目(fallback)が必須", async () => {
    const res = await putRule("PURCHASE", {
      payableAccountCode: "2101",
      taxAccountCode: "1181",
      enabled: true,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("既定科目");
  });

  it("PREPAYMENTをenabled=trueにするには前渡金・現金預金の両方が必須", async () => {
    const res = await putRule("PREPAYMENT", {
      prepaidAccountCode: "1151",
      enabled: true,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("前払の「本体」の借方・貸方");
  });

  it("必須科目が揃っていればenabled=trueで正常に更新できる", async () => {
    const res = await putRule("PREPAYMENT", {
      prepaidAccountCode: "1151",
      cashAccountCode: "1111",
      enabled: true,
    });
    expect(res.status).toBe(200);

    const row = await db
      .select()
      .from(schema.journalPostingRules)
      .where(eq(schema.journalPostingRules.eventType, "PREPAYMENT"));
    expect(row[0].enabled).toBe(true);
    expect(row[0].prepaidAccountCode).toBe("1151");
    expect(row[0].updatedBy).toBe("user-001");
  });

  it("enabled=false(無効)のままなら、科目が未設定でも保存できる(途中保存を許す)", async () => {
    const res = await putRule("SALES", {
      variableAccountPriority: "HEADER_FIRST",
      enabled: false,
    });
    expect(res.status).toBe(200);

    const row = await db
      .select()
      .from(schema.journalPostingRules)
      .where(eq(schema.journalPostingRules.eventType, "SALES"));
    expect(row[0].variableAccountPriority).toBe("HEADER_FIRST");
    expect(row[0].enabled).toBe(false);
  });

  it("不正なeventTypeを指定すると400になる", async () => {
    const res = await putRule("UNKNOWN_EVENT", { enabled: false });
    expect(res.status).toBe(400);
  });

  it("同じeventTypeを2回PUTすると新規行を増やさず上書きする(UPSERT)", async () => {
    await putRule("SALES", { variableAccountPriority: "ITEM_MASTER_FIRST", enabled: false });
    await putRule("SALES", { variableAccountPriority: "HEADER_FIRST", enabled: false });

    const rows = await db
      .select()
      .from(schema.journalPostingRules)
      .where(eq(schema.journalPostingRules.eventType, "SALES"));
    expect(rows).toHaveLength(1);
    expect(rows[0].variableAccountPriority).toBe("HEADER_FIRST");
  });
});
