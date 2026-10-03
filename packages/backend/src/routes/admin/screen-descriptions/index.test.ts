import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { screenDescriptionsRouter } from "./index";

beforeEach(async () => {
  await env.DB_UI.prepare("DELETE FROM screen_descriptions").run();
});

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await screenDescriptionsRouter.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("画面の説明(専用D1)", () => {
  it("登録・上書き・一覧・削除(既定に戻す)ができる", async () => {
    expect(((await (await call("/")).json()) as any[]).length).toBe(0);

    const saved = (await (
      await call("/", json("PUT", { path: "/sales/quotes", descriptionHtml: "<p>見積の説明</p>" }))
    ).json()) as any;
    expect(saved).toMatchObject({ path: "/sales/quotes", descriptionHtml: "<p>見積の説明</p>" });

    // 同じパスへの保存は上書き(重複しない)
    await call("/", json("PUT", { path: "/sales/quotes", descriptionHtml: "<p>更新後</p>" }));
    await call("/", json("PUT", { path: "/master/units", descriptionHtml: "単位の説明" }));
    const list = (await (await call("/")).json()) as any[];
    expect(list.map((d) => [d.path, d.descriptionHtml])).toEqual([
      ["/master/units", "単位の説明"],
      ["/sales/quotes", "<p>更新後</p>"],
    ]);

    expect((await call("/?path=/sales/quotes", { method: "DELETE" })).status).toBe(200);
    expect(((await (await call("/")).json()) as any[]).map((d) => d.path)).toEqual(["/master/units"]);
    expect((await call("/?path=/sales/quotes", { method: "DELETE" })).status).toBe(404);
  });

  it("保存時にHTMLを無害化する(script・イベント属性・javascript:を除去。リンクは別タブ+noopener)", async () => {
    const dirty =
      '<p onclick="x()">説明 <a href="https://example.com/m">マニュアル</a><a href="javascript:alert(1)">悪</a></p><script>alert(1)</script>';
    const saved = (await (await call("/", json("PUT", { path: "/progress", descriptionHtml: dirty }))).json()) as any;
    expect(saved.descriptionHtml).toBe(
      '<p>説明 <a href="https://example.com/m" target="_blank" rel="noopener noreferrer">マニュアル</a><a>悪</a></p>',
    );
    const row = await env.DB_UI.prepare("SELECT description_html AS d FROM screen_descriptions WHERE path = ?")
      .bind("/progress")
      .first<any>();
    expect(row.d).toBe(saved.descriptionHtml);
  });

  it("プレビューは無害化後のHTMLを返し、保存しない", async () => {
    const res = await call("/preview", json("POST", { body: "<b>a</b><script>x()</script>" }));
    expect(((await res.json()) as any).html).toBe("<b>a</b>");
    const row = await env.DB_UI.prepare("SELECT COUNT(*) AS n FROM screen_descriptions").first<any>();
    expect(row.n).toBe(0);
  });

  it("画面のパスが不正・説明が長すぎる場合は400", async () => {
    for (const path of ["sales/quotes", "/Sales", "/a b", "/../etc", "/" + "a".repeat(120)]) {
      expect((await call("/", json("PUT", { path, descriptionHtml: "x" }))).status, path).toBe(400);
    }
    expect((await call("/", json("PUT", { path: "/a", descriptionHtml: "x".repeat(20001) }))).status).toBe(400);
    expect((await call("/?path=bad", { method: "DELETE" })).status).toBe(400);
  });
});
