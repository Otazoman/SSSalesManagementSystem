import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as dealsSchema from "../../../db/deals-schema";
import { dealsRouter } from "./index";
import { DEALS_CSV_HEADERS, MAX_IMPORT_DEALS, MAX_IMPORT_ROWS, parseDealsCsv } from "./deals-csv-import.service";

const db = drizzle(env.DB, { schema });
const dealsDb = drizzle(env.DB_DEALS, { schema: dealsSchema });
const now = new Date("2026-09-10T00:00:00Z");
const audit = { createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now };

beforeEach(async () => {
  await dealsDb.delete(dealsSchema.dealQuotes);
  await dealsDb.delete(dealsSchema.dealAttachments);
  await dealsDb.delete(dealsSchema.dealTasks);
  await dealsDb.delete(dealsSchema.dealAttendees);
  await dealsDb.delete(dealsSchema.deals);
  await dealsDb.delete(dealsSchema.prospectContacts);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.quotes);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));

  await db.insert(schema.users).values([
    { id: "user-001", employeeNumber: "EMP001", email: "emp001@example.com", name: "営業太郎", createdAt: now, updatedAt: now },
    { id: "user-002", employeeNumber: "EMP002", email: "emp002@example.com", name: "同席花子", createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.partners).values([
    { id: "PR-1", name: "見込み商事", type: "PROSPECT", ...audit },
    { id: "PR-2", name: "別の見込み社", type: "PROSPECT", ...audit },
  ]);
  await db.insert(schema.quotes).values([
    { id: "Q-1", title: "見込み商事の見積", partnerId: "PR-1", quoteDate: now, status: "APPROVED", totalAmount: 1000, taxAmount: 0, ...audit },
    { id: "Q-2", title: "別社の見積", partnerId: "PR-2", quoteDate: now, status: "APPROVED", totalAmount: 500, taxAmount: 0, ...audit },
  ] as never);
});

// ---- CSV組み立て: 列名→値のオブジェクトの配列から、ヘッダー順のCSV文字列を作る ----
type CsvRow = Partial<Record<(typeof DEALS_CSV_HEADERS)[number], string>>;
const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
function buildCsv(rows: CsvRow[], headers: readonly string[] = DEALS_CSV_HEADERS): string {
  const lines = rows.map((r) => headers.map((h) => quote(r[h as keyof CsvRow] ?? "")).join(","));
  return [headers.join(","), ...lines].join("\n");
}
const base: CsvRow = { groupKey: "A", partnerId: "PR-1", title: "初回ヒアリング", dealDate: "2026-09-10" };

async function upload(text: string | null) {
  const form = new FormData();
  if (text !== null) form.append("file", new File([text], "deals.csv", { type: "text/csv" }));
  const ctx = createExecutionContext();
  const res = await dealsRouter.request("/bulk-register", { method: "POST", body: form }, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const allDeals = () => dealsDb.select().from(dealsSchema.deals);

describe("商談CSVインポート: 正常系", () => {
  it("同じgroupKeyの複数行が1商談にまとまり、面談者・タスク・見積が保存される(商談番号は自動採番)", async () => {
    await dealsDb.insert(dealsSchema.prospectContacts).values({
      id: "PC-1", partnerId: "PR-1", name: "佐藤", departmentName: "情報システム部", position: "部長", ...audit,
    });
    const { status, body } = await upload(
      buildCsv([
        { ...base, startTime: "10:00", endTime: "11:30", location: "先方本社", memo: "予算感あり", ownerEmployeeNumber: "EMP001", quoteIds: "Q-1", attendeeKind: "PROSPECT_CONTACT", attendeeValue: "佐藤", taskTitle: "見積提出", taskDueDate: "2026-09-17", taskAssigneeEmployeeNumber: "EMP001" },
        { groupKey: "A", attendeeKind: "EMPLOYEE", attendeeValue: "EMP002", taskTitle: "資料送付", taskIsDone: "完了" },
        { groupKey: "A", attendeeKind: "FREE", attendeeValue: "未登録の役員 田中", attendeeNote: "決裁者" },
      ]),
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, created: 1, updated: 0 });
    const deals = await allDeals();
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      partnerId: "PR-1", title: "初回ヒアリング", startTime: "10:00", endTime: "11:30",
      location: "先方本社", status: "OPEN", ownerEmployeeNumber: "EMP001",
    });
    expect(deals[0].id).toMatch(/^DL/);

    const attendees = await dealsDb.select().from(dealsSchema.dealAttendees).where(eq(dealsSchema.dealAttendees.dealId, deals[0].id));
    expect(attendees.sort((a, b) => a.sortOrder - b.sortOrder).map((a) => [a.kind, a.refId, a.name, a.note])).toEqual([
      ["PROSPECT_CONTACT", "PC-1", "佐藤", "情報システム部 部長"],
      ["EMPLOYEE", "EMP002", "同席花子", null],
      ["FREE", null, "未登録の役員 田中", "決裁者"],
    ]);
    const tasks = await dealsDb.select().from(dealsSchema.dealTasks).where(eq(dealsSchema.dealTasks.dealId, deals[0].id));
    expect(tasks.sort((a, b) => a.sortOrder - b.sortOrder).map((t) => [t.title, t.isDone, t.assigneeEmployeeNumber])).toEqual([
      ["見積提出", false, "EMP001"],
      ["資料送付", true, null],
    ]);
    const quotes = await dealsDb.select().from(dealsSchema.dealQuotes);
    expect(quotes.map((q) => q.quoteId)).toEqual(["Q-1"]);
  });

  it("複数のgroupKeyは別々の商談になる(取込順に関係なく、離れた行も同じキーならまとまる)", async () => {
    const { body } = await upload(
      buildCsv([
        { ...base, groupKey: "A", title: "商談A", attendeeKind: "FREE", attendeeValue: "甲" },
        { ...base, groupKey: "B", partnerId: "PR-2", title: "商談B" },
        { groupKey: "A", attendeeKind: "FREE", attendeeValue: "乙" },
      ]),
    );

    expect(body).toMatchObject({ created: 2, updated: 0 });
    const deals = await allDeals();
    expect(deals.map((d) => d.title).sort()).toEqual(["商談A", "商談B"]);
    const dealA = deals.find((d) => d.title === "商談A")!;
    const attendees = await dealsDb.select().from(dealsSchema.dealAttendees).where(eq(dealsSchema.dealAttendees.dealId, dealA.id));
    expect(attendees).toHaveLength(2);
  });

  it("Excelで保存し直された日付・時刻(2026/9/5、9:00)も受け付けて正規化する", async () => {
    const { status } = await upload(
      buildCsv([{ ...base, dealDate: "2026/9/5", startTime: "9:00", endTime: "9:30", taskTitle: "確認", taskDueDate: "2026/9/12" }]),
    );

    expect(status).toBe(200);
    const [deal] = await allDeals();
    expect(deal.startTime).toBe("09:00");
    expect(deal.dealDate.toISOString()).toBe("2026-09-04T15:00:00.000Z"); // 2026-09-05 00:00 JST
    const [task] = await dealsDb.select().from(dealsSchema.dealTasks);
    expect(task.dueDate?.toISOString()).toBe("2026-09-11T15:00:00.000Z");
  });

  it("dealIdに既存の商談番号を指定すると全項目を置き換える(作成者・作成日時は維持、statusが空欄なら現状維持)", async () => {
    await dealsDb.insert(dealsSchema.deals).values({
      id: "DL-EXIST", partnerId: "PR-1", title: "旧タイトル", dealDate: now, status: "WON", ...audit,
    });
    await dealsDb.insert(dealsSchema.dealAttendees).values({ id: "AT-OLD", dealId: "DL-EXIST", kind: "FREE", name: "旧面談者", sortOrder: 0 });
    await dealsDb.insert(dealsSchema.dealTasks).values({ id: "TK-OLD", dealId: "DL-EXIST", title: "旧タスク", isDone: false, sortOrder: 0 });

    const { body } = await upload(
      buildCsv([{ ...base, dealId: "DL-EXIST", title: "新タイトル", attendeeKind: "FREE", attendeeValue: "新面談者", taskTitle: "新タスク" }]),
    );

    expect(body).toMatchObject({ created: 0, updated: 1 });
    const deals = await allDeals();
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ id: "DL-EXIST", title: "新タイトル", status: "WON", createdBy: "EMP001" });
    expect(deals[0].createdAt.toISOString()).toBe(now.toISOString());
    const attendees = await dealsDb.select().from(dealsSchema.dealAttendees);
    expect(attendees.map((a) => a.name)).toEqual(["新面談者"]);
    const tasks = await dealsDb.select().from(dealsSchema.dealTasks);
    expect(tasks.map((t) => t.title)).toEqual(["新タスク"]);
  });

  it("新規と更新を同じCSVで取り込める", async () => {
    await dealsDb.insert(dealsSchema.deals).values({ id: "DL-EXIST", partnerId: "PR-1", title: "既存", dealDate: now, ...audit });

    const { body } = await upload(
      buildCsv([
        { ...base, groupKey: "A", dealId: "DL-EXIST", title: "既存(更新)" },
        { ...base, groupKey: "B", title: "新規商談" },
      ]),
    );

    expect(body).toMatchObject({ created: 1, updated: 1 });
    expect((await allDeals()).map((d) => d.title).sort()).toEqual(["新規商談", "既存(更新)"]);
  });
});

describe("商談CSVインポート: 異常系(1件でも不正なら何も登録しない)", () => {
  it("ファイル未添付は400", async () => {
    const { status, body } = await upload(null);

    expect(status).toBe(400);
    expect(body.message).toContain("CSVファイルが添付されていません");
  });

  it("ヘッダーが違う場合は400", async () => {
    const { status, body } = await upload("id,title\nDL-1,x");

    expect(status).toBe(400);
    expect(body.message).toContain("CSVヘッダー書式が正しくありません");
  });

  it("2行目以降の商談本体の項目が先頭行と異なる場合は行番号つきで400", async () => {
    const { status, body } = await upload(buildCsv([{ ...base }, { groupKey: "A", title: "別のタイトル" }]));

    expect(status).toBe(400);
    expect(body.message).toContain("3行目");
    expect(body.message).toContain("titleが先頭行(2行目)と異なります");
    expect(await allDeals()).toHaveLength(0);
  });

  it("不正な日付・種別・完了指定はすべて行番号つきで報告される", async () => {
    const { status, body } = await upload(
      buildCsv([
        { ...base, dealDate: "2026-02-30" },
        { ...base, groupKey: "B", attendeeKind: "ALIEN", attendeeValue: "x" },
        { ...base, groupKey: "C", taskTitle: "t", taskIsDone: "たぶん" },
        { ...base, groupKey: "D", startTime: "25:00" },
      ]),
    );

    expect(status).toBe(400);
    expect(body.message).toContain("2行目: dealDateはYYYY-MM-DD形式");
    expect(body.message).toContain("3行目: attendeeKindは");
    expect(body.message).toContain("4行目: taskIsDoneは");
    expect(body.message).toContain("5行目: startTimeはHH:MM形式");
  });

  it("必須項目(groupKey・取引先・商談名・商談日)が空なら400", async () => {
    const { body } = await upload(buildCsv([{ groupKey: "A" }, { partnerId: "PR-1" }]));

    expect(body.message).toContain("2行目: partnerId(取引先)は必須です");
    expect(body.message).toContain("2行目: title(商談名)は必須です");
    expect(body.message).toContain("2行目: dealDate(商談日)は必須です");
    expect(body.message).toContain("3行目: groupKey");
  });

  it("存在しない取引先・ユーザー・見積、別取引先の見積、存在しないdealIdはまとめて報告され、1件も登録されない", async () => {
    const { status, body } = await upload(
      buildCsv([
        { ...base, groupKey: "OK", title: "問題ない商談" },
        { ...base, groupKey: "BAD1", partnerId: "NOPE" },
        { ...base, groupKey: "BAD2", ownerEmployeeNumber: "EMP999", quoteIds: "Q-2 Q-404" },
        { ...base, groupKey: "BAD3", dealId: "DL-NOPE" },
      ]),
    );

    expect(status).toBe(400);
    expect(body.message).toContain("取引先[NOPE]が見つかりません");
    expect(body.message).toContain("ユーザー[EMP999]が見つかりません");
    expect(body.message).toContain("見積[Q-2]は別の取引先の見積のため紐づけできません");
    expect(body.message).toContain("見積[Q-404]が見つかりません");
    expect(body.message).toContain("dealId[DL-NOPE]の商談が見つかりません");
    expect(await allDeals()).toHaveLength(0);
  });

  it("面談者の氏名照合: 見つからない・同姓同名が複数の場合は400", async () => {
    await dealsDb.insert(dealsSchema.prospectContacts).values([
      { id: "PC-1", partnerId: "PR-1", name: "同姓同名", ...audit },
      { id: "PC-2", partnerId: "PR-1", name: "同姓同名", ...audit },
      { id: "PC-3", partnerId: "PR-2", name: "他社の人", ...audit },
    ]);

    const { status, body } = await upload(
      buildCsv([
        { ...base, groupKey: "A", attendeeKind: "PROSPECT_CONTACT", attendeeValue: "同姓同名" },
        { ...base, groupKey: "B", attendeeKind: "PROSPECT_CONTACT", attendeeValue: "他社の人" },
        { ...base, groupKey: "C", attendeeKind: "PARTNER_CONTACT", attendeeValue: "いない人" },
      ]),
    );

    expect(status).toBe(400);
    expect(body.message).toContain("見込客担当者「同姓同名」が複数あり特定できません");
    expect(body.message).toContain("見込客担当者「他社の人」が見つかりません");
    expect(body.message).toContain("取引先担当者「いない人」が見つかりません");
    expect(await allDeals()).toHaveLength(0);
  });

  it("同じdealIdがCSV内で重複していると400", async () => {
    await dealsDb.insert(dealsSchema.deals).values({ id: "DL-EXIST", partnerId: "PR-1", title: "既存", dealDate: now, ...audit });

    const { status, body } = await upload(
      buildCsv([
        { ...base, groupKey: "A", dealId: "DL-EXIST" },
        { ...base, groupKey: "B", dealId: "DL-EXIST" },
      ]),
    );

    expect(status).toBe(400);
    expect(body.message).toContain("dealId[DL-EXIST]がCSV内で重複しています");
  });
});

describe("parseDealsCsv: 件数の上限", () => {
  it(`商談数が${MAX_IMPORT_DEALS}件を超えると拒否する`, () => {
    const rows = Array.from({ length: MAX_IMPORT_DEALS + 1 }, (_, i) => ({ ...base, groupKey: `G${i}` }));

    expect(() => parseDealsCsv(buildCsv(rows))).toThrow(`商談数は${MAX_IMPORT_DEALS}件まで`);
  });

  it(`行数が${MAX_IMPORT_ROWS}行を超えると拒否する`, () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({ ...base }));

    expect(() => parseDealsCsv(buildCsv(rows))).toThrow(`行数は${MAX_IMPORT_ROWS}行まで`);
  });

  it("データ行が無いCSVは拒否する", () => {
    expect(() => parseDealsCsv(buildCsv([]))).toThrow("取り込むデータ行がありません");
  });
});
