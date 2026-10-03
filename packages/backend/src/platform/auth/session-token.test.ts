import { describe, it, expect } from "vitest";
import { signSessionToken, verifySessionToken, SessionPayload } from "./session-token";

const SECRET = "test-session-secret";

const basePayload: Omit<SessionPayload, "exp"> = {
  userId: "user-1",
  employeeNumber: "EMP001",
  name: "山田太郎",
  role: "admin",
  deptName: "全社共通",
  companyName: "サンプル株式会社",
  isAuditEnabled: true,
};

describe("signSessionToken / verifySessionToken", () => {
  it("正しい署名鍵で検証すると、元のペイロードが復元できる", async () => {
    const token = await signSessionToken(basePayload, SECRET, 3600);
    const result = await verifySessionToken(token, SECRET);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe("user-1");
    expect(result?.name).toBe("山田太郎");
    expect(result?.role).toBe("admin");
    expect(result?.deptName).toBe("全社共通");
    expect(result?.companyName).toBe("サンプル株式会社");
    expect(result?.isAuditEnabled).toBe(true);
    expect(typeof result?.exp).toBe("number");
  });

  it("異なる署名鍵で検証すると、null(拒否)を返す", async () => {
    const token = await signSessionToken(basePayload, SECRET, 3600);
    const result = await verifySessionToken(token, "different-secret");
    expect(result).toBeNull();
  });

  it("ペイロード部分を改ざんすると、署名不一致でnullを返す", async () => {
    const token = await signSessionToken(basePayload, SECRET, 3600);
    const [payloadB64, signatureB64] = token.split(".");

    // roleをadminに書き換えるための改ざんペイロードを作る(署名は元のまま流用)
    const tamperedJson = JSON.stringify({
      ...basePayload,
      role: "admin_but_tampered",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const tamperedPayloadB64 = Buffer.from(tamperedJson)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const tamperedToken = `${tamperedPayloadB64}.${signatureB64}`;
    const result = await verifySessionToken(tamperedToken, SECRET);
    expect(result).toBeNull();

    void payloadB64;
  });

  it("有効期限切れのトークンはnullを返す", async () => {
    const expiredToken = await signSessionToken(basePayload, SECRET, -10);
    const result = await verifySessionToken(expiredToken, SECRET);
    expect(result).toBeNull();
  });

  it("フォーマット不正な文字列(区切りが1つのみ等)はnullを返す", async () => {
    expect(await verifySessionToken("not-a-valid-token", SECRET)).toBeNull();
    expect(await verifySessionToken("a.b.c", SECRET)).toBeNull();
    expect(await verifySessionToken("", SECRET)).toBeNull();
  });

  it("トークンが未指定(undefined/null)の場合はnullを返す", async () => {
    expect(await verifySessionToken(undefined, SECRET)).toBeNull();
    expect(await verifySessionToken(null, SECRET)).toBeNull();
  });
});
