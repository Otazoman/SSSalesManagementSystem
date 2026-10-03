import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { buildTwoLineJournalLines, buildItemLinkedJournalLines } from "./build-journal-lines";

const db = drizzle(env.DB, { schema });
const audit = { createdBy: "EMP001", createdAt: new Date(), updatedBy: "EMP001", updatedAt: new Date() };

type RuleInsert = typeof schema.journalPostingRules.$inferInsert;

async function seedAccounts() {
  const account = (code: string, name: string, externalMappingCode: string | null = null) => ({
    code,
    name,
    externalMappingCode,
    status: "active",
    ...audit,
  });
  await db.insert(schema.accounts).values([
    account("1111", "現金預金", "EXT-1111"),
    account("1131", "売掛金"),
    account("2101", "買掛金"),
    account("2201", "前受金"),
    account("1151", "前渡金"),
    account("4101", "売上高"),
    account("5101", "仕入高"),
    account("2301", "仮受消費税"),
  ]);
}

async function seedRule(eventType: RuleInsert["eventType"], values: Partial<RuleInsert>) {
  await db.insert(schema.journalPostingRules).values({ eventType, enabled: true, ...values });
}

beforeEach(async () => {
  await db.delete(schema.journalPostingPatterns);
  await db.delete(schema.journalPostingRules);
  await db.delete(schema.accounts);
  await seedAccounts();
});

describe("buildTwoLineJournalLines", () => {
  it("入金(RECEIPT): 借方=現金預金 / 貸方=売掛金", async () => {
    await seedRule("RECEIPT", { cashAccountCode: "1111", receivableAccountCode: "1131" });
    const result = await buildTwoLineJournalLines(env.DB, "RECEIPT", 5000);
    expect(result).toEqual({
      ok: true,
      lines: [
        { side: "DEBIT", accountCode: "1111", accountName: "現金預金", externalMappingCode: "EXT-1111", amount: 5000 },
        { side: "CREDIT", accountCode: "1131", accountName: "売掛金", externalMappingCode: null, amount: 5000 },
      ],
    });
  });

  it("支払(DISBURSEMENT): 借方=買掛金 / 貸方=現金預金", async () => {
    await seedRule("DISBURSEMENT", { payableAccountCode: "2101", cashAccountCode: "1111" });
    const result = await buildTwoLineJournalLines(env.DB, "DISBURSEMENT", 3000);
    expect(result.ok && result.lines.map((l) => [l.side, l.accountCode, l.amount])).toEqual([
      ["DEBIT", "2101", 3000],
      ["CREDIT", "1111", 3000],
    ]);
  });

  it("前払: 借方=前渡金 / 貸方=現金預金、前受: 借方=現金預金 / 貸方=前受金", async () => {
    await seedRule("PREPAYMENT", { prepaidAccountCode: "1151", cashAccountCode: "1111" });
    await seedRule("ADVANCE_RECEIPT", { advanceReceivedAccountCode: "2201", cashAccountCode: "1111" });
    const prepayment = await buildTwoLineJournalLines(env.DB, "PREPAYMENT", 100);
    const advance = await buildTwoLineJournalLines(env.DB, "ADVANCE_RECEIPT", 200);
    expect(prepayment.ok && prepayment.lines.map((l) => [l.side, l.accountCode])).toEqual([
      ["DEBIT", "1151"],
      ["CREDIT", "1111"],
    ]);
    expect(advance.ok && advance.lines.map((l) => [l.side, l.accountCode])).toEqual([
      ["DEBIT", "1111"],
      ["CREDIT", "2201"],
    ]);
  });

  it("ルールが未設定・無効なら、理由つきで失敗する", async () => {
    expect(await buildTwoLineJournalLines(env.DB, "RECEIPT", 1000)).toMatchObject({
      ok: false,
      kind: "RULE_UNAVAILABLE",
    });
    await seedRule("RECEIPT", { cashAccountCode: "1111", receivableAccountCode: "1131", enabled: false });
    expect(await buildTwoLineJournalLines(env.DB, "RECEIPT", 1000)).toMatchObject({
      ok: false,
      kind: "RULE_UNAVAILABLE",
    });
  });

  it("必要な科目が未設定の場合は失敗する", async () => {
    await seedRule("RECEIPT", { cashAccountCode: "1111", receivableAccountCode: null });
    expect(await buildTwoLineJournalLines(env.DB, "RECEIPT", 1000)).toMatchObject({
      ok: false,
      kind: "RULE_UNAVAILABLE",
    });
  });
});

describe("buildItemLinkedJournalLines", () => {
  const salesLine = {
    itemId: "ITEM-1",
    itemName: "品目1",
    itemAccountCode: "4101",
    amount: 1000,
    taxCategoryCode: "TAX_10",
    taxRate: 0.1,
    taxAmount: 100,
    sourceRefItemId: "L-1",
  };

  beforeEach(async () => {
    await seedRule("SALES", {
      receivableAccountCode: "1131",
      advanceReceivedAccountCode: "2201",
      taxAccountCode: "2301",
      variableAccountFallbackCode: "4101",
    });
  });

  // 明細の行を [借方科目, 貸方科目, 金額] の組にして比べる(組ごとに借方行・貸方行の順で並ぶ)
  const pairsOf = (result: Awaited<ReturnType<typeof buildItemLinkedJournalLines>>) => {
    if (!result.ok) throw new Error(result.reason);
    const pairs: [string, string, number][] = [];
    for (let i = 0; i < result.lines.length; i += 2) {
      const [debit, credit] = [result.lines[i], result.lines[i + 1]];
      expect([debit.side, credit.side]).toEqual(["DEBIT", "CREDIT"]);
      expect(debit.amount).toBe(credit.amount);
      pairs.push([debit.accountCode, credit.accountCode, debit.amount]);
    }
    return pairs;
  };

  it("売上: 明細ごとに 売掛金/売上高 と 売掛金/仮受消費税 の組を作る", async () => {
    const result = await buildItemLinkedJournalLines(env.DB, {
      eventType: "SALES",
      documentType: "SALE",
      lines: [salesLine, { ...salesLine, itemName: "品目2", amount: 2000, taxAmount: 200, sourceRefItemId: "L-2" }],
    });
    expect(pairsOf(result)).toEqual([
      ["1131", "4101", 1000],
      ["1131", "2301", 100],
      ["1131", "4101", 2000],
      ["1131", "2301", 200],
    ]);
    // 科目名は転記時点の名前、税区分は売上高の側だけ、品目は両側に持つ
    const [debit, credit, taxDebit] = result.ok ? result.lines : [];
    expect(debit).toMatchObject({ accountName: "売掛金", itemName: "品目1", sourceRefItemId: "L-1" });
    expect(debit.taxCategoryCode).toBeUndefined();
    expect(credit).toMatchObject({ accountName: "売上高", taxCategoryCode: "TAX_10", taxRate: 0.1, itemName: "品目1" });
    expect(taxDebit.taxCategoryCode).toBeUndefined();
  });

  it("前受金の充当は、明細を売掛金で計上したうえで 前受金/売掛金 の組で振り替える", async () => {
    const result = await buildItemLinkedJournalLines(env.DB, {
      eventType: "SALES",
      documentType: "SALE",
      lines: [salesLine],
      advanceAppliedAmount: 400,
    });
    expect(pairsOf(result)).toEqual([
      ["1131", "4101", 1000],
      ["1131", "2301", 100],
      ["2201", "1131", 400],
    ]);
  });

  it("充当額は税込合計までに抑える", async () => {
    const result = await buildItemLinkedJournalLines(env.DB, {
      eventType: "SALES",
      documentType: "SALE",
      lines: [salesLine],
      advanceAppliedAmount: 5000,
    });
    expect(pairsOf(result).at(-1)).toEqual(["2201", "1131", 1100]);
  });

  it("返品は区分のパターン(既定は借方・貸方が逆)で作る。税区分は売上高の側(借方)に付く", async () => {
    const result = await buildItemLinkedJournalLines(env.DB, {
      eventType: "SALES",
      documentType: "RETURN",
      lines: [salesLine],
    });
    expect(pairsOf(result)).toEqual([
      ["4101", "1131", 1000],
      ["2301", "1131", 100],
    ]);
    expect(result.ok && result.lines[0].taxCategoryCode).toBe("TAX_10");
  });

  it("保存した組の科目を使う(値引だけ別の科目にする)", async () => {
    await db.insert(schema.accounts).values({ code: "4190", name: "売上値引高", status: "active", ...audit });
    await db.insert(schema.journalPostingPatterns).values({
      eventType: "SALES",
      documentType: "DISCOUNT",
      lineKind: "BODY",
      debitFromItem: false,
      debitAccountCode: "4190",
      creditFromItem: false,
      creditAccountCode: "1131",
    });
    const discount = await buildItemLinkedJournalLines(env.DB, { eventType: "SALES", documentType: "DISCOUNT", lines: [salesLine] });
    const sale = await buildItemLinkedJournalLines(env.DB, { eventType: "SALES", documentType: "SALE", lines: [salesLine] });
    expect(pairsOf(discount)[0]).toEqual(["4190", "1131", 1000]);
    expect(pairsOf(sale)[0]).toEqual(["1131", "4101", 1000]);
    await db.delete(schema.journalPostingPatterns);
  });

  it("マイナスの明細は、金額を正にして借方・貸方を入れ替える", async () => {
    const result = await buildItemLinkedJournalLines(env.DB, {
      eventType: "SALES",
      documentType: "SALE",
      lines: [salesLine, { ...salesLine, itemName: "値引", amount: -300, taxAmount: -30 }],
    });
    expect(pairsOf(result).slice(2)).toEqual([
      ["4101", "1131", 300],
      ["2301", "1131", 30],
    ]);
  });

  it("前受金の科目が無いまま充当すると失敗する", async () => {
    await db.delete(schema.journalPostingRules);
    await seedRule("SALES", { receivableAccountCode: "1131", taxAccountCode: "2301", variableAccountFallbackCode: "4101" });
    const result = await buildItemLinkedJournalLines(env.DB, {
      eventType: "SALES",
      documentType: "SALE",
      lines: [salesLine],
      advanceAppliedAmount: 100,
    });
    expect(result).toMatchObject({ ok: false, kind: "RULE_UNAVAILABLE" });
    expect(!result.ok && result.reason).toContain("売上・前受・前渡の充当");
  });

  it("品目にも既定にも科目が無い場合は、品目名つきで失敗する", async () => {
    await db.delete(schema.journalPostingRules);
    await seedRule("SALES", {
      receivableAccountCode: "1131",
      taxAccountCode: "2301",
      variableAccountFallbackCode: null,
    });
    const result = await buildItemLinkedJournalLines(env.DB, {
      eventType: "SALES",
      documentType: "SALE",
      lines: [{ ...salesLine, itemAccountCode: null }],
    });
    expect(result).toMatchObject({ ok: false, kind: "ACCOUNT_UNRESOLVED" });
    expect(!result.ok && result.reason).toContain("品目1");
  });

  it("ルールが無い(無効)なら失敗する", async () => {
    await db.delete(schema.journalPostingRules);
    expect(await buildItemLinkedJournalLines(env.DB, { eventType: "SALES", documentType: "SALE", lines: [salesLine] })).toMatchObject({
      ok: false,
      kind: "RULE_UNAVAILABLE",
    });
  });
});
