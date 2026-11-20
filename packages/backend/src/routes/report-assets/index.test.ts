import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { signSessionToken } from "../../platform/auth/session-token";
import { reportAssetsRouter } from "./index";

// PERF-07 B-2: ブラウザで PDF を作るための、フォント・ロゴ・社印を返す API

async function cookie() {
  const token = await signSessionToken(
    {
      userId: "user-1",
      employeeNumber: "EMP001",
      name: "利用者",
      role: "general_user",
      deptName: "",
      companyName: "",
      isAuditEnabled: false,
    },
    await env.SESSION_SECRET.get(),
    3600,
  );
  return `session_token=${token}`;
}

async function get(path: string, headers: Record<string, string> = {}) {
  return reportAssetsRouter.request(path, { headers }, env);
}

beforeEach(async () => {
  await env.SYSTEM_BUCKET.delete(["fonts/company_fonts.ttf", "company/company_logo.png", "company/company_seal.png"]);
  await env.SYSTEM_BUCKET.put("fonts/company_fonts.ttf", new Uint8Array([1, 2, 3, 4]));
  await env.SYSTEM_BUCKET.put("company/company_logo.png", new Uint8Array([9, 9]));
});

describe("GET /api/report-assets/:name(PERF-07 B-2)", () => {
  it("ログインしていなければ 401", async () => {
    expect((await get("/font")).status).toBe(401);
  });

  it("フォント・ロゴ・社印以外の名前は 404", async () => {
    expect((await get("/other", { Cookie: await cookie() })).status).toBe(404);
  });

  it("フォントを、種類・ETag・キャッシュの指定を付けて返す", async () => {
    const res = await get("/font", { Cookie: await cookie() });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(res.headers.get("Content-Type")).toBe("font/ttf");
    expect(res.headers.get("ETag")).toMatch(/^"/);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("If-None-Match が今の ETag と同じなら 304(中身は送らない)。フォントを差し替えると新しい中身と ETag を返す", async () => {
    const first = await get("/font", { Cookie: await cookie() });
    const etag = first.headers.get("ETag")!;

    const notModified = await get("/font", { Cookie: await cookie(), "If-None-Match": etag });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("ETag")).toBe(etag);
    expect((await notModified.arrayBuffer()).byteLength).toBe(0);

    await env.SYSTEM_BUCKET.put("fonts/company_fonts.ttf", new Uint8Array([5, 6, 7]));
    const replaced = await get("/font", { Cookie: await cookie(), "If-None-Match": etag });
    expect(replaced.status).toBe(200);
    expect(replaced.headers.get("ETag")).not.toBe(etag);
    expect(new Uint8Array(await replaced.arrayBuffer())).toEqual(new Uint8Array([5, 6, 7]));
  });

  it("ロゴは image/png で返し、登録されていない社印は 404", async () => {
    const logo = await get("/logo", { Cookie: await cookie() });
    expect(logo.status).toBe(200);
    expect(logo.headers.get("Content-Type")).toBe("image/png");
    expect((await get("/seal", { Cookie: await cookie() })).status).toBe(404);
  });
});
