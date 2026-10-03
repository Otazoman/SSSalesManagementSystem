import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { announcementsRouter } from "./index";

beforeEach(async () => {
  await env.DB_UI.prepare("DELETE FROM announcements").run();
  await env.COMPANY_SETTINGS.delete("system_announcements");
  // 従来KVからの取り込みは、テストごとに「済み」にしておく(取り込みを試すテストだけ印を消す)
  await env.COMPANY_SETTINGS.put("system_announcements_migrated_to_d1", "test");
});

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await announcementsRouter.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const base = { title: "お知らせ", body: "<p>本文</p>", publishDate: "2020-01-01", isImportant: false, isPublished: true };

describe("システムからのお知らせ(専用D1)", () => {
  it("登録・一覧・更新・削除ができる", async () => {
    const created = (await (await call("/register", json("POST", base))).json()) as any;
    expect(created.id).toBeTruthy();

    const list = (await (await call("/")).json()) as any[];
    expect(list).toHaveLength(1);

    const updated = (await (await call(`/${created.id}`, json("PUT", { ...base, title: "更新後" }))).json()) as any;
    expect(updated.title).toBe("更新後");

    expect((await call(`/${created.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await (await call("/")).json()) as any[]).toHaveLength(0);
    expect((await call(`/${created.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("削除したお知らせは、直後のダッシュボード用一覧(/active)からも消える", async () => {
    const a = (await (await call("/register", json("POST", { ...base, title: "残す" }))).json()) as any;
    const b = (await (await call("/register", json("POST", { ...base, title: "消す" }))).json()) as any;
    expect(((await (await call("/active")).json()) as any[]).map((x) => x.title).sort()).toEqual(["残す", "消す"]);

    expect((await call(`/${b.id}`, { method: "DELETE" })).status).toBe(200);
    const active = (await (await call("/active")).json()) as any[];
    expect(active.map((x) => x.title)).toEqual(["残す"]);
    expect(active[0].id).toBe(a.id);
    // D1の行そのものが無い
    const row = await env.DB_UI.prepare("SELECT COUNT(*) AS n FROM announcements WHERE id = ?").bind(b.id).first<any>();
    expect(row.n).toBe(0);
  });

  it("ダッシュボード用は公開中・掲載期間内のみで、重要なものが先頭", async () => {
    await call("/register", json("POST", { ...base, title: "通常" }));
    await call("/register", json("POST", { ...base, title: "重要", isImportant: true, publishDate: "2019-01-01" }));
    await call("/register", json("POST", { ...base, title: "下書き", isPublished: false }));
    await call("/register", json("POST", { ...base, title: "未来", publishDate: "2999-01-01" }));
    await call("/register", json("POST", { ...base, title: "期限切れ", endDate: "2020-12-31" }));

    const active = (await (await call("/active")).json()) as any[];
    expect(active.map((a) => a.title)).toEqual(["重要", "通常"]);
    expect(((await (await call("/")).json()) as any[]).length).toBe(5);
  });

  it("タイトル未入力・日付形式不正は400", async () => {
    expect((await call("/register", json("POST", { ...base, title: "  " }))).status).toBe(400);
    expect((await call("/register", json("POST", { ...base, publishDate: "2020/01/01" }))).status).toBe(400);
  });
});

describe("お知らせ本文(HTML)", () => {
  it("リンク・書式を保存でき、外部リンクは別タブ+noopenerになる", async () => {
    const created = (await (
      await call("/register", json("POST", { ...base, body: '<p><b>重要</b>: <a href="https://example.com/manual">マニュアル</a>をご確認ください</p>' }))
    ).json()) as any;
    expect(created.body).toBe(
      '<p><b>重要</b>: <a href="https://example.com/manual" target="_blank" rel="noopener noreferrer">マニュアル</a>をご確認ください</p>',
    );
    const active = (await (await call("/active")).json()) as any[];
    expect(active[0].body).toBe(created.body);
  });

  it("保存時に危険なHTML(script・イベント属性・javascript:リンク)を除去する。更新時も同様", async () => {
    const dirty = '<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">b</a><img src=x onerror=alert(1)>';
    const created = (await (await call("/register", json("POST", { ...base, body: dirty }))).json()) as any;
    expect(created.body).toBe("<p>a</p><a>b</a><img>");
    const updated = (await (await call(`/${created.id}`, json("PUT", { ...base, body: dirty }))).json()) as any;
    expect(updated.body).toBe("<p>a</p><a>b</a><img>");
    // DBに保存された値も無害化済み
    const row = await env.DB_UI.prepare("SELECT body FROM announcements WHERE id = ?").bind(created.id).first<any>();
    expect(row.body).toBe("<p>a</p><a>b</a><img>");
  });

  it("プレビュー: 実際に表示される(無害化後の)HTMLを返し、DBには保存しない", async () => {
    const res = await call("/preview", json("POST", { body: '<b>太字</b><script>alert(1)</script><a href="https://e.example">x</a>' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).html).toBe('<b>太字</b><a href="https://e.example" target="_blank" rel="noopener noreferrer">x</a>');
    const row = await env.DB_UI.prepare("SELECT COUNT(*) AS n FROM announcements").first<any>();
    expect(row.n).toBe(0);
    expect((await call("/preview", json("POST", { body: "x".repeat(20001) }))).status).toBe(400);
  });
});

describe("従来のKVからD1への移行", () => {
  const legacy = [
    { id: "old-1", title: "旧お知らせ", body: "1行目\n<b>2行目</b>", publishDate: "2020-01-01", endDate: null, isImportant: true, isPublished: true, createdBy: "E1", createdAt: "2020-01-01T00:00:00Z", updatedBy: "E1", updatedAt: "2020-01-01T00:00:00Z" },
  ];

  it("D1が空で、移行済みの印が無い時に1度だけ取り込み、平文の本文は安全なHTMLへ変換する", async () => {
    await env.COMPANY_SETTINGS.delete("system_announcements_migrated_to_d1");
    await env.COMPANY_SETTINGS.put("system_announcements", JSON.stringify(legacy));

    const list = (await (await call("/")).json()) as any[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "old-1", title: "旧お知らせ", isImportant: true });
    expect(list[0].body).toBe("1行目<br>&lt;b&gt;2行目&lt;/b&gt;"); // 平文だった本文は、タグも文字として扱う

    // 取り込み済み: 全件削除してD1が空になっても、再取り込みしない
    expect((await call("/old-1", { method: "DELETE" })).status).toBe(200);
    expect((await (await call("/")).json()) as any[]).toHaveLength(0);
    expect(await env.COMPANY_SETTINGS.get("system_announcements_migrated_to_d1")).toBeTruthy();
  });

  it("D1に既にデータがある時は、KVを取り込まない", async () => {
    await call("/register", json("POST", { ...base, title: "新規" }));
    await env.COMPANY_SETTINGS.delete("system_announcements_migrated_to_d1");
    await env.COMPANY_SETTINGS.put("system_announcements", JSON.stringify(legacy));
    const list = (await (await call("/")).json()) as any[];
    expect(list.map((a) => a.title)).toEqual(["新規"]);
  });
});
