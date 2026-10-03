import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import * as journalSchema from "../../../db/journal-schema";
import { journalExportRouter } from "./index";
import { orderBatchesByCorrectionChain } from "./journal-export.service";
import { DEFAULT_JOURNAL_EXPORT_FORMAT } from "../journal-export-format/journal-export-format.service";

const db = drizzle(env.DB, { schema });
const journalDb = drizzle(env.DB_JOURNAL, { schema: journalSchema });
const now = new Date();

beforeEach(async () => {
  await journalDb.delete(journalSchema.journalLines);
  await journalDb.delete(journalSchema.journalBatches);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.orders);
  await db.delete(schema.purchaseRequests);
  await db.delete(schema.departments);
  await db.delete(schema.users);

  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
});

async function seedBatch(
  id: string,
  overrides: Partial<typeof journalSchema.journalBatches.$inferInsert> = {},
) {
  await journalDb.insert(journalSchema.journalBatches).values({
    id,
    entryDate: now,
    description: "テスト仕訳",
    sourceType: "sales_invoice",
    sourceRefId: "SI-1",
    eventType: "SALES",
    totalDebitAmount: 11000,
    totalCreditAmount: 11000,
    postedById: "EMP001",
    postedAt: now,
    ...overrides,
  });
  await journalDb.insert(journalSchema.journalLines).values([
    {
      id: `${id}-L1`,
      batchId: id,
      lineNo: 1,
      side: "DEBIT",
      accountCode: "1301",
      accountName: "売掛金",
      amount: 11000,
    },
    {
      id: `${id}-L2`,
      batchId: id,
      lineNo: 2,
      side: "CREDIT",
      accountCode: "4101",
      accountName: "商品売上高",
      externalMappingCode: "EXT-4101",
      amount: 11000,
    },
  ]);
}

async function callCsv(query = "") {
  const ctx = createExecutionContext();
  const res = await journalExportRouter.request(`/csv-download${query}`, {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("GET /csv-download", () => {
  it("計上日・摘要・区分・金額を含むCSVを出力する(反対仕訳・訂正仕訳のスナップショットも含む)", async () => {
    await seedBatch("B-1");
    const res = await callCsv();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");

    const text = await res.text();
    const lines = text.split("\n");
    expect(lines[0]).toContain("仕訳バッチID");
    expect(lines[0]).toContain("プロジェクトID");
    expect(lines[0]).toContain("部署");
    expect(lines).toHaveLength(3); // header + 2 lines
    expect(lines[1]).toContain("元仕訳");
    expect(lines[1]).toContain("SI-1");
    expect(lines[1]).toContain("借方");
    expect(lines[2]).toContain("貸方");
    expect(lines[2]).toContain("EXT-4101");
  });

  it("プロジェクト(journal_batchesにスナップショット済みの値)をそのまま出力する", async () => {
    await seedBatch("B-2", { projectId: "PJ-1", projectName: "テストプロジェクト" });
    const res = await callCsv();
    const text = await res.text();
    expect(text).toContain("PJ-1");
    expect(text).toContain("テストプロジェクト");
  });

  it("承認申請テーブルに部署が記録されている場合(承認機能有効)はそこから部署名を出力する", async () => {
    await db.insert(schema.departments).values({
      surrogateId: "DEPT-SUR-1",
      id: "DEPT-1",
      name: "営業部",
      validFrom: now,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.masterApprovalRequests).values({
      id: "MAR-1",
      targetType: "sales_invoices",
      targetId: "SI-1",
      requestType: "SALES_INVOICE",
      status: "APPROVED",
      applicantDepartmentSurrogateId: "DEPT-SUR-1",
      applicantId: "EMP001",
      createdAt: now,
      updatedAt: now,
    });
    await seedBatch("B-3");

    const res = await callCsv();
    const text = await res.text();
    expect(text).toContain("営業部");
  });

  it("購入側は承認申請が無くても購買申請の部署へフォールバックする", async () => {
    await db.insert(schema.departments).values({
      surrogateId: "DEPT-SUR-2",
      id: "DEPT-2",
      name: "資材部",
      validFrom: now,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.purchaseRequests).values({
      id: "PR-1",
      title: "テスト購買申請",
      departmentSurrogateId: "DEPT-SUR-2",
      applicantId: "EMP001",
      status: "APPROVED",
      totalAmount: 11000,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.orders).values({
      id: "PO-1",
      requestId: "PR-1",
      orderDate: now,
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await seedBatch("B-4", { sourceType: "purchase_order", sourceRefId: "PO-1", eventType: "PREPAYMENT" });

    const res = await callCsv();
    const text = await res.text();
    expect(text).toContain("資材部");
  });

  it("sourceTypeで絞り込める", async () => {
    await seedBatch("B-5", { sourceType: "sales_invoice", sourceRefId: "SI-5" });
    await seedBatch("B-6", { sourceType: "purchase_order", sourceRefId: "PO-6", eventType: "PREPAYMENT" });

    const res = await callCsv("?sourceType=purchase_order");
    const text = await res.text();
    expect(text).toContain("PO-6");
    expect(text).not.toContain("SI-5");
  });

  it("該当データが無い場合はヘッダーのみのCSVを返す", async () => {
    const res = await callCsv();
    const text = await res.text();
    const lines = text.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("仕訳バッチID");
  });
});

describe("Item11-3: 訂正チェーンの出力", () => {
  const t = (n: number) => new Date(2026, 0, n);
  const batch = (id: string, day: number, rev: string | null = null, cor: string | null = null) => ({
    id,
    entryDate: t(day),
    reversalOfBatchId: rev,
    correctionOfBatchId: cor,
  });

  it("元→反対→訂正が連続し、グループ同士は先頭バッチの計上日順に並ぶ", () => {
    const ordered = orderBatchesByCorrectionChain([
      batch("O2", 2),
      batch("C1", 5, null, "O1"),
      batch("R1", 5, "O1"),
      batch("O1", 1),
      batch("O3", 3),
    ]);
    expect(ordered.map((b) => b.id)).toEqual(["O1", "R1", "C1", "O2", "O3"]);
  });

  it("訂正仕訳が再訂正された場合も同一グループとして連続する", () => {
    const ordered = orderBatchesByCorrectionChain([
      batch("C2", 9, null, "C1"),
      batch("R2", 9, "C1"),
      batch("O9", 4),
      batch("C1", 5, null, "O1"),
      batch("R1", 5, "O1"),
      batch("O1", 1),
    ]);
    expect(ordered.map((b) => b.id)).toEqual(["O1", "R1", "C1", "R2", "C2", "O9"]);
  });

  it("元仕訳が出力対象外(期間外等)の場合は、含まれる中で最上位のバッチを先頭にする", () => {
    const ordered = orderBatchesByCorrectionChain([batch("C1", 5, null, "O1"), batch("R1", 5, "O1")]);
    expect(ordered.map((b) => b.id)).toEqual(["R1", "C1"]);
  });

  it("訂正元バッチID列・基底元伝票番号列を有効にすると反対/訂正仕訳から元を辿れる", async () => {
    await env.COMPANY_SETTINGS.put(
      "journal_export_format",
      JSON.stringify({
        ...DEFAULT_JOURNAL_EXPORT_FORMAT,
        columns: DEFAULT_JOURNAL_EXPORT_FORMAT.columns.map((c) =>
          c.key === "originalBatchId" || c.key === "baseSourceRefId" ? { ...c, enabled: true } : c,
        ),
      }),
    );
    try {
      await seedBatch("B-ORIG", { sourceRefId: "SI-9" });
      await seedBatch("B-REV", { sourceRefId: "SI-9#rev-aaaa", reversalOfBatchId: "B-ORIG" });

      const text = await (await callCsv()).text();
      const lines = text.split("\n");
      expect(lines[0]).toContain("訂正元仕訳バッチID");
      const revLine = lines.find((l) => l.includes("反対仕訳"))!;
      expect(revLine).toContain("B-ORIG");
      expect(revLine).toContain("SI-9#rev-aaaa");
      expect(revLine.split(",").some((f) => f === '"SI-9"')).toBe(true);
    } finally {
      await env.COMPANY_SETTINGS.delete("journal_export_format");
    }
  });

  it("既定フォーマットでは新しい2列は出力されない(既存の出力結果を変えない)", async () => {
    await seedBatch("B-X");
    const text = await (await callCsv()).text();
    expect(text.split("\n")[0]).not.toContain("訂正元仕訳バッチID");
  });

  it("layout=PAIR では「借方〇〇/貸方〇〇」の組を1行に出す", async () => {
    const pairKeys = new Set(["debitAccountName", "debitAmount", "creditAccountName", "creditAmount", "creditExternalMappingCode"]);
    await env.COMPANY_SETTINGS.put(
      "journal_export_format",
      JSON.stringify({
        ...DEFAULT_JOURNAL_EXPORT_FORMAT,
        layout: "PAIR",
        columns: DEFAULT_JOURNAL_EXPORT_FORMAT.columns.map((c) => ({
          ...c,
          enabled: c.key === "sourceRefId" || pairKeys.has(c.key),
        })),
      }),
    );
    try {
      await seedBatch("B-P");
      const lines = (await (await callCsv()).text()).split("\n");
      expect(lines).toHaveLength(2); // header + 1組
      expect(lines[0]).toContain("借方勘定科目名");
      expect(lines[1]).toBe('"SI-1","売掛金",11000,"商品売上高","EXT-4101",11000');
    } finally {
      await env.COMPANY_SETTINGS.delete("journal_export_format");
    }
  });

  it("layout=LINE(既定)で借方・貸方の列を使うと、その行の側だけ値が入る", async () => {
    await env.COMPANY_SETTINGS.put(
      "journal_export_format",
      JSON.stringify({
        ...DEFAULT_JOURNAL_EXPORT_FORMAT,
        columns: DEFAULT_JOURNAL_EXPORT_FORMAT.columns.map((c) => ({
          ...c,
          enabled: c.key === "debitAccountName" || c.key === "creditAccountName",
        })),
      }),
    );
    try {
      await seedBatch("B-L");
      const lines = (await (await callCsv()).text()).split("\n");
      expect(lines.slice(1)).toEqual(['"売掛金",""', '"","商品売上高"']);
    } finally {
      await env.COMPANY_SETTINGS.delete("journal_export_format");
    }
  });
});
