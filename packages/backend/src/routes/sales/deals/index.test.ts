import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import * as dealsSchema from "../../../db/deals-schema";
import { dealsRouter } from "./index";

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

async function call(path: string, method = "GET", body?: unknown) {
  const ctx = createExecutionContext();
  const res = await dealsRouter.request(
    path,
    {
      method,
      headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function createProspectContact(partnerId = "PR-1", name = "見込客の佐藤") {
  const res = await call("/prospect-contacts", "POST", { partnerId, name, departmentName: "情報システム部", position: "部長" });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

async function register(overrides: Record<string, unknown> = {}) {
  const res = await call("/register", "POST", {
    partnerId: "PR-1",
    title: "初回ヒアリング",
    dealDate: "2026-09-10",
    ...overrides,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

describe("追加要望M-1: 商談管理(専用DB)", () => {
  it("見込み客への商談を、面談者・タスク・見積つきで登録でき、伝票番号が自動採番される。データは専用DBに保存される", async () => {
    const contactId = await createProspectContact();
    const id = await register({
      startTime: "10:00",
      endTime: "11:30",
      location: "先方本社",
      memo: "予算感は500万円",
      ownerEmployeeNumber: "EMP001",
      attendees: [
        { kind: "PROSPECT_CONTACT", refId: contactId },
        { kind: "EMPLOYEE", refId: "EMP002" },
        { kind: "FREE", name: "未登録の役員 田中", note: "決裁者" },
      ],
      tasks: [{ title: "見積提出", dueDate: "2026-09-17", assigneeEmployeeNumber: "EMP001" }],
      quoteIds: ["Q-1"],
    });
    expect(id).toMatch(/^DL/);

    // 商談データは専用DBにあり、メインDBには存在しない
    expect((await dealsDb.select().from(dealsSchema.deals)).length).toBe(1);

    const detail = (await (await call(`/${id}`)).json()) as any;
    expect(detail).toMatchObject({
      partnerId: "PR-1",
      partnerName: "見込み商事",
      title: "初回ヒアリング",
      dealDate: "2026-09-10",
      startTime: "10:00",
      endTime: "11:30",
      status: "OPEN",
      ownerName: "営業太郎",
    });
    expect(detail.attendees.map((a: any) => [a.kind, a.name])).toEqual([
      ["PROSPECT_CONTACT", "見込客の佐藤"],
      ["EMPLOYEE", "同席花子"],
      ["FREE", "未登録の役員 田中"],
    ]);
    expect(detail.attendees[0].note).toBe("情報システム部 部長");
    expect(detail.tasks[0]).toMatchObject({ title: "見積提出", dueDate: "2026-09-17", assigneeName: "営業太郎", isDone: false });
    expect(detail.quotes).toMatchObject([{ id: "Q-1", title: "見込み商事の見積", totalAmount: 1000 }]);
  });

  it("会社設定の伝票番号フォーマット(deal)に従って採番される(プレフィックス・桁数の変更、プレフィックスなし)", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ document_number_formats: { deal: { usePrefix: true, prefix: "MTG", digitCount: 6 } } }),
    );
    // プレフィックスあり: "MTG-" + 6桁の数字(衝突時のみ末尾に-1等が付く)
    expect(await register()).toMatch(/^MTG-\d{6}(-\d+)?$/);

    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ document_number_formats: { deal: { usePrefix: false, prefix: "", digitCount: 8 } } }),
    );
    // プレフィックスなし: 8桁の数字だけ
    expect(await register({ title: "プレフィックスなし" })).toMatch(/^\d{8}(-\d+)?$/);
  });

  it("1見込み客に複数の商談を登録でき、一覧で取引先・状態・期間・キーワード・未完了タスクで絞り込める", async () => {
    await register({ title: "初回ヒアリング", dealDate: "2026-09-01", tasks: [{ title: "資料送付" }] });
    await register({ title: "提案", dealDate: "2026-09-15", status: "WON" });
    await register({ partnerId: "PR-2", title: "別社の商談", dealDate: "2026-09-20" });

    const list = async (query: string) => ((await (await call(`/${query}`)).json()) as any[]).map((d) => d.title);
    expect(await list("")).toEqual(["別社の商談", "提案", "初回ヒアリング"]); // 商談日の新しい順
    expect(await list("?partnerId=PR-1")).toEqual(["提案", "初回ヒアリング"]);
    expect(await list("?status=WON")).toEqual(["提案"]);
    expect(await list("?startDate=2026-09-10&endDate=2026-09-15")).toEqual(["提案"]);
    expect(await list("?keyword=別社")).toEqual(["別社の商談"]);
    expect(await list("?openTasks=true")).toEqual(["初回ヒアリング"]);

    const first = ((await (await call("/?partnerId=PR-1")).json()) as any[]).find((d) => d.title === "初回ヒアリング");
    expect(first).toMatchObject({ partnerName: "見込み商事", taskCount: 1, openTaskCount: 1, attachmentCount: 0 });
  });

  it("入力不正(存在しない取引先・ユーザー・別取引先の見積/見込客担当者・時刻の前後・氏名なしの自由記入)は400", async () => {
    const otherContact = await createProspectContact("PR-2", "別社の担当");
    const bad = async (overrides: Record<string, unknown>) =>
      (await call("/register", "POST", { partnerId: "PR-1", title: "商談", dealDate: "2026-09-10", ...overrides })).status;

    expect(await bad({ partnerId: "NOPE" })).toBe(400);
    expect(await bad({ title: "" })).toBe(400);
    expect(await bad({ dealDate: "2026/09/10" })).toBe(400);
    expect(await bad({ startTime: "25:00" })).toBe(400);
    expect(await bad({ startTime: "11:00", endTime: "10:00" })).toBe(400);
    expect(await bad({ ownerEmployeeNumber: "NOPE" })).toBe(400);
    expect(await bad({ quoteIds: ["Q-2"] })).toBe(400); // 別取引先の見積
    expect(await bad({ quoteIds: ["NOPE"] })).toBe(400);
    expect(await bad({ attendees: [{ kind: "FREE" }] })).toBe(400);
    expect(await bad({ attendees: [{ kind: "EMPLOYEE", refId: "NOPE" }] })).toBe(400);
    expect(await bad({ attendees: [{ kind: "PROSPECT_CONTACT", refId: otherContact }] })).toBe(400); // 別取引先の担当者
    expect(await bad({ tasks: [{ title: "" }] })).toBe(400);
    expect((await dealsDb.select().from(dealsSchema.deals)).length).toBe(0);
  });

  it("取引先担当者マスタの相手も面談者にでき、氏名はスナップショット保存される", async () => {
    await db.insert(schema.partnerContacts).values({
      id: "PC-1",
      partnerId: "PR-1",
      contactType: "CUSTOMER_CONTACT",
      name: "登録済みの鈴木",
      departmentName: "営業部",
      ...audit,
    });
    const id = await register({ attendees: [{ kind: "PARTNER_CONTACT", refId: "PC-1" }] });

    const candidates = (await (await call("/attendee-candidates?partnerId=PR-1")).json()) as any;
    expect(candidates.partnerContacts.map((c: any) => c.name)).toEqual(["登録済みの鈴木"]);

    await db.delete(schema.partnerContacts);
    const detail = (await (await call(`/${id}`)).json()) as any;
    expect(detail.attendees[0]).toMatchObject({ kind: "PARTNER_CONTACT", name: "登録済みの鈴木", note: "営業部" });
  });

  it("更新は面談者・タスク・見積を置き換え、既存タスクの完了状態は保持される", async () => {
    const id = await register({ tasks: [{ title: "資料送付" }, { title: "日程調整" }], quoteIds: ["Q-1"] });
    const before = (await (await call(`/${id}`)).json()) as any;
    const doneTask = before.tasks[0].id;
    await call(`/${id}/tasks/${doneTask}/done`, "PUT", { isDone: true });

    const res = await call(`/${id}`, "PUT", {
      partnerId: "PR-1",
      title: "初回ヒアリング(更新)",
      dealDate: "2026-09-11",
      status: "OPEN",
      attendees: [{ kind: "FREE", name: "新しい相手" }],
      tasks: [
        { id: doneTask, title: "資料送付(更新)" }, // 既存タスクの更新(isDone省略=完了状態を保持)
        { title: "新規タスク" },
      ],
      quoteIds: [],
    });
    expect(res.status).toBe(200);

    const after = (await (await call(`/${id}`)).json()) as any;
    expect(after.title).toBe("初回ヒアリング(更新)");
    expect(after.attendees.map((a: any) => a.name)).toEqual(["新しい相手"]);
    expect(after.quotes).toEqual([]);
    expect(after.tasks.map((t: any) => [t.title, t.isDone])).toEqual([
      ["資料送付(更新)", true],
      ["新規タスク", false],
    ]);
    expect(after.tasks[0].id).toBe(doneTask);
    expect((await call("/NOPE", "PUT", { partnerId: "PR-1", title: "x", dealDate: "2026-09-10" })).status).toBe(404);
  });

  it("次回までのタスクを完了/未完了に切り替えられ、未完了タスク一覧を担当者で絞り込める", async () => {
    const id = await register({
      tasks: [
        { title: "遅い期限", dueDate: "2026-09-30", assigneeEmployeeNumber: "EMP001" },
        { title: "早い期限", dueDate: "2026-09-12", assigneeEmployeeNumber: "EMP002" },
        { title: "期限なし" },
      ],
    });
    const tasks = ((await (await call(`/${id}`)).json()) as any).tasks;

    let open = (await (await call("/tasks")).json()) as any[];
    expect(open.map((t) => t.title)).toEqual(["早い期限", "遅い期限", "期限なし"]); // 期限の早い順、期限なしは最後
    expect(open[0]).toMatchObject({ dealId: id, dealTitle: "初回ヒアリング", partnerName: "見込み商事", assigneeName: "同席花子" });
    expect(((await (await call("/tasks?assigneeEmployeeNumber=EMP001")).json()) as any[]).map((t) => t.title)).toEqual(["遅い期限"]);
    // 取引先で絞り込むと、その取引先の商談のタスクのみ
    const otherId = await register({ partnerId: "PR-2", title: "別社の商談", tasks: [{ title: "別社のタスク", dueDate: "2026-09-01" }] });
    const byPartner = (await (await call("/tasks?partnerId=PR-2")).json()) as any[];
    expect(byPartner.map((t) => [t.title, t.dealId, t.partnerId])).toEqual([["別社のタスク", otherId, "PR-2"]]);
    expect(((await (await call("/tasks?partnerId=PR-1")).json()) as any[]).map((t) => t.title)).toEqual(["早い期限", "遅い期限", "期限なし"]);
    await call(`/${otherId}`, "DELETE");

    const done = tasks.find((t: any) => t.title === "早い期限").id;
    expect((await call(`/${id}/tasks/${done}/done`, "PUT", { isDone: true })).status).toBe(200);
    open = (await (await call("/tasks")).json()) as any[];
    expect(open.map((t) => t.title)).toEqual(["遅い期限", "期限なし"]);
    const detail = (await (await call(`/${id}`)).json()) as any;
    expect(detail.tasks.find((t: any) => t.id === done)).toMatchObject({ isDone: true });
    expect(detail.tasks.find((t: any) => t.id === done).doneAt).not.toBeNull();

    await call(`/${id}/tasks/${done}/done`, "PUT", { isDone: false });
    expect(((await (await call("/tasks")).json()) as any[]).length).toBe(3);

    expect((await call(`/${id}/tasks/NOPE/done`, "PUT", { isDone: true })).status).toBe(404);
    expect((await call(`/${id}/tasks/${done}/done`, "PUT", {})).status).toBe(400);
  });

  it("見込客担当者を登録・更新・削除でき、削除しても過去の商談の面談者名は残る", async () => {
    const contactId = await createProspectContact();
    const list = (await (await call("/prospect-contacts?partnerId=PR-1")).json()) as any[];
    expect(list.map((c) => c.name)).toEqual(["見込客の佐藤"]);
    expect(((await (await call("/prospect-contacts?partnerId=PR-2")).json()) as any[]).length).toBe(0);

    expect((await call("/prospect-contacts", "POST", { partnerId: "NOPE", name: "x" })).status).toBe(400);
    expect((await call("/prospect-contacts", "POST", { partnerId: "PR-1", name: "" })).status).toBe(400);

    expect((await call(`/prospect-contacts/${contactId}`, "PUT", { partnerId: "PR-1", name: "見込客の佐藤(更新)", email: "s@example.com" })).status).toBe(200);
    // 所属する取引先は変更できない
    expect((await call(`/prospect-contacts/${contactId}`, "PUT", { partnerId: "PR-2", name: "x" })).status).toBe(400);

    const id = await register({ attendees: [{ kind: "PROSPECT_CONTACT", refId: contactId }] });
    expect((await call(`/prospect-contacts/${contactId}`, "DELETE")).status).toBe(200);
    expect((await call(`/prospect-contacts/${contactId}`, "DELETE")).status).toBe(404);
    const detail = (await (await call(`/${id}`)).json()) as any;
    expect(detail.attendees[0].name).toBe("見込客の佐藤(更新)");
  });

  it("添付ファイルを専用バケットにアップロード・取得・削除でき、商談を削除すると実体も削除される", async () => {
    const id = await register();
    const form = new FormData();
    form.append("file", new File(["議事録の内容"], "議事録.txt", { type: "text/plain" }));
    const up = await call(`/${id}/attachments`, "POST", form);
    expect(up.status).toBe(200);
    const { id: attachmentId } = (await up.json()) as { id: string };

    const detail = (await (await call(`/${id}`)).json()) as any;
    expect(detail.attachments).toMatchObject([{ id: attachmentId, fileName: "議事録.txt" }]);

    const [row] = await dealsDb.select().from(dealsSchema.dealAttachments);
    expect(row.attachmentR2Path).toMatch(/^deals\/.+_議事録\.txt$/);
    expect(await env.DEALS_BUCKET.head(row.attachmentR2Path)).not.toBeNull();

    const download = await call(`/${id}/attachments/${attachmentId}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("議事録の内容");
    expect((await call(`/${id}/attachments/NOPE`)).status).toBe(404);

    // ファイル無し・存在しない商談
    expect((await call(`/${id}/attachments`, "POST", new FormData())).status).toBe(400);
    const form2 = new FormData();
    form2.append("file", new File(["x"], "x.txt"));
    expect((await call("/NOPE/attachments", "POST", form2)).status).toBe(404);

    // 添付単体の削除
    expect((await call(`/${id}/attachments/${attachmentId}`, "DELETE")).status).toBe(200);
    expect(await env.DEALS_BUCKET.head(row.attachmentR2Path)).toBeNull();
    expect((await call(`/${id}/attachments/${attachmentId}`, "DELETE")).status).toBe(404);

    // 商談削除で残りの添付の実体も消える
    const form3 = new FormData();
    form3.append("file", new File(["y"], "y.txt", { type: "text/plain" }));
    await call(`/${id}/attachments`, "POST", form3);
    const [row3] = await dealsDb.select().from(dealsSchema.dealAttachments);
    expect((await call(`/${id}`, "DELETE")).status).toBe(200);
    expect(await env.DEALS_BUCKET.head(row3.attachmentR2Path)).toBeNull();
  });

  it("商談を削除すると面談者・タスク・見積紐づけも削除され、存在しなければ404", async () => {
    const id = await register({
      attendees: [{ kind: "FREE", name: "相手" }],
      tasks: [{ title: "タスク" }],
      quoteIds: ["Q-1"],
    });
    expect((await call(`/${id}`, "DELETE")).status).toBe(200);
    expect((await call(`/${id}`)).status).toBe(404);
    expect((await dealsDb.select().from(dealsSchema.dealAttendees)).length).toBe(0);
    expect((await dealsDb.select().from(dealsSchema.dealTasks)).length).toBe(0);
    expect((await dealsDb.select().from(dealsSchema.dealQuotes)).length).toBe(0);
    expect((await call("/NOPE", "DELETE")).status).toBe(404);
    // 見積(メインDB)は削除されない
    expect((await db.select().from(schema.quotes)).length).toBe(2);
  });

  it("見積の候補は同じ取引先の見積のみ", async () => {
    const candidates = (await (await call("/quote-candidates?partnerId=PR-1")).json()) as any[];
    expect(candidates.map((q) => q.id)).toEqual(["Q-1"]);
    expect((await call("/quote-candidates")).status).toBe(400);
  });

  it("CSVを出力できる(検索条件を反映。インポートと同じ形式で、詳細はdeals-csv-roundtrip.test.ts)", async () => {
    await register({ attendees: [{ kind: "FREE", name: "田中" }], tasks: [{ title: "宿題" }], quoteIds: ["Q-1"] });
    await register({ partnerId: "PR-2", title: "別社" });
    const res = await call("/csv-download?partnerId=PR-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Deals-Export-Total")).toBe("1");
    expect(res.headers.get("X-Deals-Export-Included")).toBe("1");
    const lines = (await res.text()).trim().split(String.fromCharCode(13) + String.fromCharCode(10));
    expect(lines[0]).toContain("groupKey,dealId,partnerId");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"PR-1"');
    expect(lines[1]).toContain('"FREE","田中"');
    expect(lines[1]).toContain('"Q-1"');
    expect(lines[1]).toContain('"宿題"');
  });

  it("page を指定すると {data, pagination} でページ単位に返し、指定しなければ従来どおり配列で返す(BUG-032)", async () => {
    await register({ title: "商談A", dealDate: "2026-09-10" });
    await register({ title: "商談B", dealDate: "2026-09-11" });
    await register({ title: "商談C", dealDate: "2026-09-12" });

    const page1 = (await (await call("/?page=1&limit=2")).json()) as any;
    expect(page1.data.map((d: any) => d.title)).toEqual(["商談C", "商談B"]);
    expect(page1.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    const page2 = (await (await call("/?page=2&limit=2")).json()) as any;
    expect(page2.data.map((d: any) => d.title)).toEqual(["商談A"]);

    const all = (await (await call("/")).json()) as any[];
    expect(all).toHaveLength(3);
  });
});
