import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import * as v from "valibot";
import { handleServerError, rejectMalformedJson, respondError } from "./error-handler";
import { NotFoundError } from "./http-error";

interface ErrorResponseBody {
  success: boolean;
  message: string;
  errorId: string;
  error?: unknown;
}

async function readJson(res: Response): Promise<ErrorResponseBody> {
  return (await res.json()) as ErrorResponseBody;
}

function buildApp() {
  const app = new Hono();

  app.get("/default-message", async (c) => {
    return handleServerError(c, new Error("boom"));
  });

  app.get("/custom-message", async (c) => {
    return handleServerError(c, new Error("boom"), "カスタムメッセージ");
  });

  app.get("/non-error-value", async (c) => {
    return handleServerError(c, "文字列のまま投げられたエラー");
  });

  app.onError((err, c) => handleServerError(c, err));
  app.get("/uncaught", async () => {
    throw new Error("caught by global onError");
  });

  return app;
}

describe("handleServerError", () => {
  it("常にHTTP 500・success:falseを返す", async () => {
    const app = buildApp();
    const res = await app.request("/default-message");
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(body.success).toBe(false);
  });

  it("customMessageを省略した場合はデフォルトの日本語メッセージに問い合わせ番号を付ける", async () => {
    const app = buildApp();
    const res = await app.request("/default-message");
    const body = await readJson(res);
    expect(body.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(body.message).toBe(`内部サーバーエラーが発生しました(問い合わせ番号: ${body.errorId})`);
  });

  it("customMessageを渡した場合はそれがmessageに使われる", async () => {
    const app = buildApp();
    const res = await app.request("/custom-message");
    const body = await readJson(res);
    expect(body.message).toBe(`カスタムメッセージ(問い合わせ番号: ${body.errorId})`);
  });

  it("エラーの内部情報(名前・メッセージ・スタックトレース)は返さない(BUG-025)", async () => {
    const app = buildApp();
    const res = await app.request("/default-message");
    const text = await res.text();
    expect(text).not.toContain("boom");
    expect(text).not.toContain("stack");
    expect((JSON.parse(text) as ErrorResponseBody).error).toBeUndefined();
  });

  it("問い合わせ番号は、エラーごとに変わる", async () => {
    const app = buildApp();
    const a = await readJson(await app.request("/default-message"));
    const b = await readJson(await app.request("/default-message"));
    expect(a.errorId).not.toBe(b.errorId);
  });

  it("Errorインスタンスでない値(文字列等)が渡されても例外を投げずに処理する", async () => {
    const app = buildApp();
    const res = await app.request("/non-error-value");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("文字列のまま投げられたエラー");
  });

  it("Honoのapp.onError経由(未捕捉例外)でも同じ形式のレスポンスになる", async () => {
    const app = buildApp();
    const res = await app.request("/uncaught");
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(body)).not.toContain("caught by global onError");
  });
});

describe("respondError", () => {
  function buildRespondApp(err: unknown) {
    const app = new Hono();
    app.get("/", async (c) => respondError(c, err, "処理に失敗しました"));
    return app;
  }

  it("入力チェックのエラーは400で、項目ごとの内容をerrorsに付ける", async () => {
    let err: unknown;
    try {
      v.parse(v.object({ name: v.string() }), { name: 1 });
    } catch (e) {
      err = e;
    }
    const res = await buildRespondApp(err).request("/");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; message: string; errors: unknown[] };
    expect(body.success).toBe(false);
    expect(body.message).toBe("入力内容に不備があります");
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("業務エラーはそのステータスで、メッセージをそのまま返す", async () => {
    const res = await buildRespondApp(new NotFoundError("対象の見積が見つかりません")).request("/");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "対象の見積が見つかりません" });
  });

  it("想定外のエラーは500で、元のエラー文を返さない", async () => {
    const res = await buildRespondApp(new Error("D1_ERROR: no such column")).request("/");
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(body.message).toBe(`処理に失敗しました(問い合わせ番号: ${body.errorId})`);
    expect(JSON.stringify(body)).not.toContain("D1_ERROR");
  });
});

describe("rejectMalformedJson", () => {
  function buildJsonApp() {
    const app = new Hono();
    app.use("*", rejectMalformedJson);
    app.post("/", async (c) => {
      const text = await c.req.text();
      return c.json({ received: text === "" ? null : await c.req.json() });
    });
    return app;
  }
  const post = (body: string) =>
    buildJsonApp().request("/", { method: "POST", headers: { "Content-Type": "application/json" }, body });

  it("本文の JSON が壊れている場合は、各 API の前に 400 で返す", async () => {
    const res = await post("{bad json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, message: "リクエストの形式が正しくありません" });
  });

  it("正しい JSON は、各 API がそのまま読める", async () => {
    const res = await post('{"a":1}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: { a: 1 } });
  });

  it("本文が空の場合は、各 API に任せる", async () => {
    const res = await post("");
    expect(res.status).toBe(200);
  });
});
