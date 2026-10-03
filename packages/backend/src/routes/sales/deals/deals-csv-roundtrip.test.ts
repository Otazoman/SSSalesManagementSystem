import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import * as dealsSchema from "../../../db/deals-schema";
import { dealsRouter } from "./index";
import { DEALS_CSV_HEADERS } from "./deals-csv-import.service";
import { MAX_WRITE_STATEMENTS, estimateWriteStatements } from "./deals-batch-budget";

// 商談CSVは「出力したファイルをそのまま再取込できる」ことが要件。出力→取込のラウンドトリップを検証する

const db = drizzle(env.DB, { schema });
const dealsDb = drizzle(env.DB_DEALS, { schema: dealsSchema });
const now = new Date("2026-09-10T00:00:00Z");
const audit = { createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now };
const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + NL;

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
  await db.insert(schema.partners).values([{ id: "PR-1", name: "見込み商事", type: "PROSPECT", ...audit }]);
  await db.insert(schema.quotes).values([
    { id: "Q-1", title: "見積", partnerId: "PR-1", quoteDate: now, status: "APPROVED", totalAmount: 1000, taxAmount: 0, ...audit },
  ] as never);
});

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await dealsRouter.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function register(body: Record<string, unknown>) {
  const res = await call("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partnerId: "PR-1", title: "初回ヒアリング", dealDate: "2026-09-10", ...body }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

async function exportCsv(query = "") {
  const res = await call(`/csv-download${query}`);
  expect(res.status).toBe(200);
  return {
    text: await res.text(),
    total: Number(res.headers.get("X-Deals-Export-Total")),
    included: Number(res.headers.get("X-Deals-Export-Included")),
  };
}

async function importCsv(text: string) {
  const form = new FormData();
  form.append("file", new File([text], "deals.csv", { type: "text/csv" }));
  const res = await call("/bulk-register", { method: "POST", body: form });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

// 商談の内容を、IDや更新日時などを除いた比較用の形にする
async function snapshot(dealId: string) {
  const [deal] = await dealsDb.select().from(dealsSchema.deals).where(eq(dealsSchema.deals.id, dealId));
  const attendees = await dealsDb.select().from(dealsSchema.dealAttendees).where(eq(dealsSchema.dealAttendees.dealId, dealId));
  const tasks = await dealsDb.select().from(dealsSchema.dealTasks).where(eq(dealsSchema.dealTasks.dealId, dealId));
  const quotes = await dealsDb.select().from(dealsSchema.dealQuotes).where(eq(dealsSchema.dealQuotes.dealId, dealId));
  return {
    deal: {
      partnerId: deal.partnerId, title: deal.title, dealDate: deal.dealDate.toISOString(), startTime: deal.startTime,
      endTime: deal.endTime, location: deal.location, memo: deal.memo, status: deal.status,
      ownerEmployeeNumber: deal.ownerEmployeeNumber, createdBy: deal.createdBy, createdAt: deal.createdAt.toISOString(),
    },
    attendees: attendees.sort((a, b) => a.sortOrder - b.sortOrder).map((a) => [a.kind, a.refId, a.name, a.note]),
    tasks: tasks
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => [t.title, t.dueDate?.toISOString() ?? null, t.assigneeEmployeeNumber, t.isDone, t.doneAt?.toISOString() ?? null]),
    quotes: quotes.map((q) => q.quoteId).sort(),
  };
}

describe("商談CSVダウンロード: インポートと同じ形式", () => {
  it("ヘッダーはインポートと同じで、1商談が(面談者・タスクの多い方の)行数に展開される。商談本体は先頭行のみ", async () => {
    const id = await register({
      startTime: "10:00", endTime: "11:00", location: "先方本社", ownerEmployeeNumber: "EMP001", quoteIds: ["Q-1"],
      attendees: [{ kind: "EMPLOYEE", refId: "EMP002" }, { kind: "FREE", name: "田中", note: "決裁者" }, { kind: "FREE", name: "鈴木" }],
      tasks: [{ title: "見積提出", dueDate: "2026-09-17", assigneeEmployeeNumber: "EMP001" }],
    });

    const { text, total, included } = await exportCsv();

    const lines = text.trim().split(CRLF);
    expect(lines[0].replace(String.fromCharCode(0xfeff), "")).toBe(DEALS_CSV_HEADERS.join(","));
    expect(lines).toHaveLength(1 + 3);
    expect(lines[1]).toContain(`"${id}","${id}","PR-1","初回ヒアリング","2026-09-10","10:00","11:00","先方本社"`);
    expect(lines[1]).toContain('"EMPLOYEE","EMP002"');
    expect(lines[1]).toContain('"見積提出","2026-09-17","EMP001","0"');
    // 2行目以降は商談本体の項目が空欄で、groupKeyだけが入る
    expect(lines[2].startsWith(`"${id}","","","",`)).toBe(true);
    expect(lines[2]).toContain('"FREE","田中","決裁者"');
    expect([total, included]).toEqual([1, 1]);
  });

  it("検索条件(取引先など)を反映する", async () => {
    await db.insert(schema.partners).values({ id: "PR-2", name: "別社", type: "PROSPECT", ...audit });
    await register({});
    await register({ partnerId: "PR-2", title: "別社の商談" });

    const { text, total } = await exportCsv("?partnerId=PR-2");

    expect(total).toBe(1);
    expect(text).toContain("別社の商談");
    expect(text).not.toContain("初回ヒアリング");
  });
});

describe("商談CSV: 出力したファイルをそのまま再インポートできる(ラウンドトリップ)", () => {
  it("全項目(複数行メモ・見込客担当者・完了済みタスクの完了日時を含む)が再インポート後も同じ。新規は増えず同じ商談の更新になる", async () => {
    await dealsDb.insert(dealsSchema.prospectContacts).values({
      id: "PC-1", partnerId: "PR-1", name: "佐藤", departmentName: "情報システム部", position: "部長", ...audit,
    });
    const id = await register({
      startTime: "09:30", endTime: "10:30", location: "先方本社", ownerEmployeeNumber: "EMP001", quoteIds: ["Q-1"],
      memo: ["予算感は500万円", "", '決裁者は"田中"部長, 来月確定'].join(NL),
      attendees: [
        { kind: "PROSPECT_CONTACT", refId: "PC-1" },
        { kind: "EMPLOYEE", refId: "EMP002", note: "技術担当" },
        { kind: "FREE", name: "未登録の役員 田中", note: "決裁者" },
      ],
      tasks: [
        { title: "見積提出", dueDate: "2026-09-17", assigneeEmployeeNumber: "EMP001" },
        { title: "資料送付", isDone: true },
      ],
    });
    // 完了日時を過去の固定値にして、再取込で「今」に書き換わらないことを確認する
    const doneAt = new Date("2026-09-11T03:04:05Z");
    await dealsDb.update(dealsSchema.dealTasks).set({ doneAt }).where(eq(dealsSchema.dealTasks.title, "資料送付"));
    const before = await snapshot(id);

    const { text } = await exportCsv();
    const { status, body } = await importCsv(text);

    expect(status).toBe(200);
    expect(body).toMatchObject({ created: 0, updated: 1 });
    expect(await dealsDb.select().from(dealsSchema.deals)).toHaveLength(1);
    expect(await snapshot(id)).toEqual(before);
    expect(before.deal.memo).toContain(NL);
  });

  it("担当者が改名されていても(氏名では特定できない)、出力は担当者IDで書かれ再インポートできる", async () => {
    await dealsDb.insert(dealsSchema.prospectContacts).values({ id: "PC-1", partnerId: "PR-1", name: "旧姓 佐藤", ...audit });
    const id = await register({ attendees: [{ kind: "PROSPECT_CONTACT", refId: "PC-1" }] });
    await dealsDb.update(dealsSchema.prospectContacts).set({ name: "新姓 佐藤" }).where(eq(dealsSchema.prospectContacts.id, "PC-1"));

    const { text } = await exportCsv();
    expect(text).toContain('"PROSPECT_CONTACT","PC-1"');
    const { status } = await importCsv(text);

    expect(status).toBe(200);
    const [attendee] = await dealsDb.select().from(dealsSchema.dealAttendees).where(eq(dealsSchema.dealAttendees.dealId, id));
    expect(attendee).toMatchObject({ refId: "PC-1", name: "新姓 佐藤" });
  });

  it("同姓同名の担当者がいる場合も、担当者IDで書かれるので正しい担当者に戻る", async () => {
    await dealsDb.insert(dealsSchema.prospectContacts).values([
      { id: "PC-1", partnerId: "PR-1", name: "同姓同名", ...audit },
      { id: "PC-2", partnerId: "PR-1", name: "同姓同名", ...audit },
    ]);
    const id = await register({ attendees: [{ kind: "PROSPECT_CONTACT", refId: "PC-2" }] });

    const { text } = await exportCsv();
    const { status } = await importCsv(text);

    expect(status).toBe(200);
    const [attendee] = await dealsDb.select().from(dealsSchema.dealAttendees).where(eq(dealsSchema.dealAttendees.dealId, id));
    expect(attendee.refId).toBe("PC-2");
  });

  it("出力を編集して再インポートすると、その内容に置き換わる(タイトルの変更)", async () => {
    const id = await register({});
    const { text } = await exportCsv();

    const { status } = await importCsv(text.replace("初回ヒアリング", "編集後のタイトル"));

    expect(status).toBe(200);
    const [deal] = await dealsDb.select().from(dealsSchema.deals).where(eq(dealsSchema.deals.id, id));
    expect(deal.title).toBe("編集後のタイトル");
  });
});

describe("商談CSV: D1の書き込み文数の上限", () => {
  async function seedHeavyDeals(count: number, attendeesEach: number) {
    for (let d = 0; d < count; d++) {
      const id = `DL-HEAVY-${d}`;
      await dealsDb.insert(dealsSchema.deals).values({
        id, partnerId: "PR-1", title: `大きい商談${d}`, dealDate: new Date(now.getTime() - d * 86400000), ...audit,
      });
      // D1は1文100変数までのため、面談者(1行5変数)は15行ずつ入れる
      for (let i = 0; i < attendeesEach; i += 15) {
        await dealsDb.insert(dealsSchema.dealAttendees).values(
          Array.from({ length: Math.min(15, attendeesEach - i) }, (_, k) => ({
            id: `AT-${d}-${i + k}`, dealId: id, kind: "FREE", name: `面談者${i + k}`, sortOrder: i + k,
          })),
        );
      }
    }
  }

  it("出力は、取込の上限に収まる先頭の商談までにして、件数の差をヘッダーで返す(出力した分は必ず取込できる)", async () => {
    await seedHeavyDeals(5, 100);

    const { text, total, included } = await exportCsv();

    expect(total).toBe(5);
    expect(included).toBeGreaterThan(0);
    expect(included).toBeLessThan(5);
    const volume = { deals: included, updates: included, attendees: included * 100, tasks: 0, quotes: 0 };
    expect(estimateWriteStatements(volume)).toBeLessThanOrEqual(MAX_WRITE_STATEMENTS);
    expect((await importCsv(text)).status).toBe(200);
  });

  it("1商談だけで上限を超える場合でも、その商談は出力する(先頭の商談は必ず含める)", async () => {
    await seedHeavyDeals(1, 500);

    const { included } = await exportCsv();

    expect(included).toBe(1);
  });

  it("取込: 書き込み量が上限を超えるCSVは1件も登録せず、分割を促す400を返す", async () => {
    const header = DEALS_CSV_HEADERS.join(",");
    const cells = (over: Record<string, string>) =>
      DEALS_CSV_HEADERS.map((h) => `"${over[h] ?? ""}"`).join(",");
    const rows = [
      cells({ groupKey: "A", partnerId: "PR-1", title: "面談者が多い商談", dealDate: "2026-09-10", attendeeKind: "FREE", attendeeValue: "面談者0" }),
      ...Array.from({ length: 450 }, (_, i) =>
        cells({ groupKey: "A", attendeeKind: "FREE", attendeeValue: `面談者${i + 1}` }),
      ),
    ];

    const { status, body } = await importCsv([header, ...rows].join(NL));

    expect(status).toBe(400);
    expect(body.message).toContain("1回に取り込める量を超えています");
    expect(await dealsDb.select().from(dealsSchema.deals)).toHaveLength(0);
  });
});

describe("商談CSV取込: 複数行メモを含むファイルの行番号", () => {
  it("引用符内の改行を含むレコードの後ろの行番号は、物理行で報告される", async () => {
    const header = DEALS_CSV_HEADERS.join(",");
    const cells = (over: Record<string, string>) =>
      DEALS_CSV_HEADERS.map((h) => `"${(over[h] ?? "").replace(/"/g, '""')}"`).join(",");
    const good = cells({ groupKey: "A", partnerId: "PR-1", title: "正常", dealDate: "2026-09-10", memo: ["1行目", "2行目", "3行目"].join(NL) });
    const bad = cells({ groupKey: "B", partnerId: "PR-1", title: "", dealDate: "2026-09-10" });

    const { status, body } = await importCsv([header, good, bad].join(NL));

    expect(status).toBe(400);
    // ヘッダー(1行目)+メモが3行にまたがるレコード(2〜4行目)の次なので、不正な行は5行目
    expect(body.message).toContain("5行目: title(商談名)は必須です");
  });
});
