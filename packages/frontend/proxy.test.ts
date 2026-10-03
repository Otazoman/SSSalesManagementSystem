import { describe, it, expect, vi, afterEach } from "vitest";
import proxyWorker, { type Env } from "./proxy";

// proxy.ts自体がplatform/auth/session-token.tsと同一アルゴリズムの検証専用実装を
// 自己完結的に持っているのと同様、テスト側でも署名生成のみを自己完結で用意する
// (Backend側の実装とはあえて共有しない設計にそろえる)。
function base64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signTestToken(
  payload: {
    userId: string;
    name: string;
    role: string;
    deptName: string;
    companyName: string;
    isAuditEnabled: boolean;
  },
  secret = "test-session-secret",
  maxAgeSeconds = 3600,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const payloadB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify({ ...payload, exp })),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );
  return `${payloadB64}.${base64urlEncode(signature)}`;
}

const VALID_USER_PAYLOAD = {
  userId: "user-1",
  name: "テストユーザー",
  role: "general_user",
  deptName: "テスト部署",
  companyName: "テスト会社",
  isAuditEnabled: true,
};

const VALID_ADMIN_PAYLOAD = { ...VALID_USER_PAYLOAD, role: "admin" };

// #14-2: Secrets Store化により、API_KEY/SESSION_SECRETは文字列ではなく
// { get(): Promise<string> } のオブジェクトになった。テストではその形を模倣する
// (値を空文字にすると「未設定」を再現できる。get()がthrowするケースはproxy.ts側のtry/catchで
// nullとして扱われるため、空文字での模倣で同じ分岐を検証できる)。
function fakeSecret(value: string): { get: () => Promise<string> } {
  return { get: async () => value };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: {
      fetch: async () =>
        new Response("<html>ok</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    } as unknown as Env["ASSETS"],
    // Service Binding の代わり。各テストが vi.stubGlobal("fetch") で差し替えた fetch に委ねる
    // (呼び出し時点のグローバル fetch を使うため、スタブが効く)
    BACKEND: {
      fetch: (req: Request) => fetch(req),
    } as unknown as Env["BACKEND"],
    API_KEY: fakeSecret("test-api-key"),
    SESSION_SECRET: fakeSecret("test-session-secret"),
    ...overrides,
  };
}

const dummyCtx = {} as never;

function callProxy(path: string, init: RequestInit = {}, env: Env = makeEnv()) {
  const request = new Request(`https://frontend.example.com${path}`, init);
  return proxyWorker.fetch(request as never, env as never, dummyCtx);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxy.ts /api/* ガード", () => {
  it("非公開APIパスへ、有効なセッションcookie無しでアクセスすると401を返し、Backendへ転送しない", async () => {
    const fetchSpy = vi.fn(async () => new Response("should-not-be-called"));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await callProxy("/api/units");

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("非公開APIパスへ、有効なセッションcookieがあればBackendへ転送し、X-API-KEYを付与する", async () => {
    const fetchSpy = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const token = await signTestToken(VALID_USER_PAYLOAD);
    const res = await callProxy("/api/units", {
      headers: { Cookie: `session_token=${token}` },
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const forwardedRequest = fetchSpy.mock.calls[0][0] as Request;
    // Service Binding ではホスト部分は使われない(パスとクエリだけが Backend に渡る)
    expect(forwardedRequest.url).toBe("https://backend/api/units");
    expect(forwardedRequest.headers.get("X-API-KEY")).toBe("test-api-key");
  });

  it("ログインAPI(/api/auth/login)は、セッションcookie無しでもBackendへ転送する", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await callProxy("/api/auth/login", { method: "POST" });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Item4-c: 見積書OTPダウンロードのdownload-requestは、セッションcookie無しでもBackendへ転送する", async () => {
    const fetchSpy = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await callProxy(
      "/api/quotes/download-request/QT-1/ATT-1",
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const forwardedRequest = fetchSpy.mock.calls[0][0] as Request;
    expect(forwardedRequest.headers.get("X-API-KEY")).toBe("test-api-key");
  });

  it("Item4-c: 見積書OTPダウンロードのdownload-verifyは、セッションcookie無しでもBackendへ転送する", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await callProxy("/api/quotes/download-verify/QT-1/ATT-1", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Item6 Phase6-4: 出荷指示書OTPダウンロードのdownload-requestは、セッションcookie無しでもBackendへ転送する", async () => {
    const fetchSpy = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await callProxy(
      "/api/shipment-instructions/download-request/SI-1/ATT-1",
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const forwardedRequest = fetchSpy.mock.calls[0][0] as Request;
    expect(forwardedRequest.headers.get("X-API-KEY")).toBe("test-api-key");
  });

  it("Item6 Phase6-4: 入荷指示書OTPダウンロードのdownload-request/verifyは、セッションcookie無しでもBackendへ転送する", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const requestRes = await callProxy(
      "/api/receipt-instructions/download-request/RI-1/ATT-1",
      { method: "POST" },
    );
    const verifyRes = await callProxy(
      "/api/receipt-instructions/download-verify/RI-1/ATT-1",
      { method: "POST" },
    );

    expect(requestRes.status).toBe(200);
    expect(verifyRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("Item7: 注文請書OTPダウンロードのdownload-request/verifyは、セッションcookie無しでもBackendへ転送する", async () => {
    const fetchSpy = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const requestRes = await callProxy(
      "/api/sales-orders/download-request/SO-1/ATT-1",
      { method: "POST" },
    );
    const verifyRes = await callProxy("/api/sales-orders/download-verify/SO-1/ATT-1", {
      method: "POST",
    });

    expect(requestRes.status).toBe(200);
    expect(verifyRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const forwardedRequest = fetchSpy.mock.calls[0][0] as Request;
    expect(forwardedRequest.headers.get("X-API-KEY")).toBe("test-api-key");
  });

  it("追加要望: 請求書OTPダウンロードのdownload-request/verifyは、セッションcookie無しでもBackendへ転送する", async () => {
    const fetchSpy = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const requestRes = await callProxy(
      "/api/sales-billing/download-request/BL-1",
      { method: "POST" },
    );
    const verifyRes = await callProxy("/api/sales-billing/download-verify/BL-1", {
      method: "POST",
    });

    expect(requestRes.status).toBe(200);
    expect(verifyRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const forwardedRequest = fetchSpy.mock.calls[0][0] as Request;
    expect(forwardedRequest.headers.get("X-API-KEY")).toBe("test-api-key");
  });

  it("改ざんされた(署名鍵が異なる)セッションcookieでは401を返す", async () => {
    const fetchSpy = vi.fn(async () => new Response("should-not-be-called"));
    vi.stubGlobal("fetch", fetchSpy);

    const tamperedToken = await signTestToken(VALID_ADMIN_PAYLOAD, "wrong-secret");
    const res = await callProxy("/api/units", {
      headers: { Cookie: `session_token=${tamperedToken}` },
    });

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Backendへの転送は Service Binding(env.BACKEND)で行い、グローバルのfetchは使わない(クエリも引き継ぐ)", async () => {
    const globalFetchSpy = vi.fn(async () => new Response("should-not-be-called"));
    vi.stubGlobal("fetch", globalFetchSpy);
    const bindingSpy = vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response(JSON.stringify({ totalUsers: 0 }), { status: 200 }),
    );

    const res = await callProxy(
      "/api/users/count?x=1",
      {},
      makeEnv({ BACKEND: { fetch: bindingSpy } as unknown as Env["BACKEND"] }),
    );

    expect(res.status).toBe(200);
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(bindingSpy).toHaveBeenCalledTimes(1);
    const forwardedRequest = bindingSpy.mock.calls[0][0];
    expect(new URL(forwardedRequest.url).pathname + new URL(forwardedRequest.url).search).toBe(
      "/api/users/count?x=1",
    );
    expect(forwardedRequest.headers.get("X-API-KEY")).toBe("test-api-key");
  });

  it("Service Binding(BACKEND)が設定されていない場合、500を返す", async () => {
    const res = await callProxy(
      "/api/users/count",
      {},
      makeEnv({ BACKEND: undefined as unknown as Env["BACKEND"] }),
    );
    expect(res.status).toBe(500);
  });

  it("SESSION_SECRET等の設定が欠けている場合、500を返す", async () => {
    const res = await callProxy(
      "/api/units",
      {},
      makeEnv({ SESSION_SECRET: fakeSecret("") }),
    );
    expect(res.status).toBe(500);
  });

  it("SESSION_SECRETの取得自体が失敗する(Secrets Store未設定)場合も、500を返す", async () => {
    const res = await callProxy(
      "/api/units",
      {},
      makeEnv({
        SESSION_SECRET: {
          get: async () => {
            throw new Error("Secret not found");
          },
        },
      }),
    );
    expect(res.status).toBe(500);
  });
});

describe("proxy.ts ページルートのガード", () => {
  it("非公開ページへ、セッションcookie無しでアクセスすると/loginへリダイレクトする", async () => {
    const res = await callProxy("/dashboard");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://frontend.example.com/login");
  });

  it("公開ページ(/login)はセッションcookie無しでもリダイレクトされない", async () => {
    const res = await callProxy("/login");
    expect(res.status).toBe(200);
  });

  it("Item4-c: 見積書OTPダウンロード公開ページはセッションcookie無しでもリダイレクトされない", async () => {
    const res = await callProxy("/quote-download?quoteId=QT-1&attachmentId=ATT-1");
    expect(res.status).toBe(200);
  });

  it("Item6 Phase6-4: 出荷指示書/入荷指示書OTPダウンロード公開ページはセッションcookie無しでもリダイレクトされない", async () => {
    const shipmentRes = await callProxy(
      "/shipment-instruction-download?instructionId=SI-1&attachmentId=ATT-1",
    );
    const receiptRes = await callProxy(
      "/receipt-instruction-download?instructionId=RI-1&attachmentId=ATT-1",
    );
    expect(shipmentRes.status).toBe(200);
    expect(receiptRes.status).toBe(200);
  });

  it("Item7: 注文請書OTPダウンロード公開ページはセッションcookie無しでもリダイレクトされない", async () => {
    const res = await callProxy("/order-download?orderId=SO-1&attachmentId=ATT-1");
    expect(res.status).toBe(200);
  });

  it("追加要望: 請求書OTPダウンロード公開ページはセッションcookie無しでもリダイレクトされない", async () => {
    const res = await callProxy("/billing-download?billingId=BL-1");
    expect(res.status).toBe(200);
  });

  it("静的アセット(favicon.ico等)はセッションcookie無しでもリダイレクトされない", async () => {
    const res = await callProxy("/favicon.ico");
    expect(res.status).toBe(200);
  });

  it("有効なセッションcookieがあれば、非公開ページへアクセスできる", async () => {
    const token = await signTestToken(VALID_USER_PAYLOAD);
    const res = await callProxy("/dashboard", {
      headers: { Cookie: `session_token=${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("/admin配下は、admin以外のroleだと/dashboardへリダイレクトされる", async () => {
    const token = await signTestToken(VALID_USER_PAYLOAD); // role: general_user
    const res = await callProxy("/admin/users", {
      headers: { Cookie: `session_token=${token}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://frontend.example.com/dashboard?error=unauthorized",
    );
  });

  it("/admin配下は、adminのroleならアクセスできる", async () => {
    const token = await signTestToken(VALID_ADMIN_PAYLOAD);
    const res = await callProxy("/admin/users", {
      headers: { Cookie: `session_token=${token}` },
    });
    expect(res.status).toBe(200);
  });
});
