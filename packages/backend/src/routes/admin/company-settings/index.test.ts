import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { companySettingsRouter } from "./index";
import { isQuoteWorkflowGloballyEnabled } from "../../../workflow-engine/settings";

/**
 * Frontendリファクタ3-0（ページネーション有効/無効フラグ）の追加に伴う最小限のテスト。
 * company-settings機能自体の既存テストは元々存在しないため、新規追加分のみを対象とする。
 */

beforeEach(async () => {
  await env.COMPANY_SETTINGS.delete("config");
});

describe("GET /", () => {
  it("KV未設定時、is_pagination_enabledはデフォルトでfalseを返す", async () => {
    const res = await companySettingsRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_pagination_enabled).toBe(false);
  });
});

describe("PUT /", () => {
  it("is_pagination_enabledをtrueで保存すると、以後のGETに反映される", async () => {
    const putRes = await companySettingsRouter.request(
      "/",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pagination_enabled: true }),
      },
      env,
    );
    expect(putRes.status).toBe(200);

    const getRes = await companySettingsRouter.request("/", {}, env);
    const body = await getRes.json();
    expect(body.is_pagination_enabled).toBe(true);
  });

  it("document_number_formatsを保存すると、以後のGETに種別ごとの設定が反映される", async () => {
    const putRes = await companySettingsRouter.request(
      "/",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_number_formats: {
            sales_order: { usePrefix: true, prefix: "JYU", digitCount: 6 },
            audit: { usePrefix: false, prefix: "", digitCount: 3 },
          },
        }),
      },
      env,
    );
    expect(putRes.status).toBe(200);

    const getRes = await companySettingsRouter.request("/", {}, env);
    const body = await getRes.json();
    expect(body.document_number_formats.sales_order).toEqual({
      usePrefix: true,
      prefix: "JYU",
      digitCount: 6,
    });
    expect(body.document_number_formats.audit).toEqual({
      usePrefix: false,
      prefix: "",
      digitCount: 3,
    });
  });

  it("master_code_formatsを保存すると、以後のGETに種別ごとの設定が反映される", async () => {
    const putRes = await companySettingsRouter.request(
      "/",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          master_code_formats: {
            partners: { usePrefix: true, prefix: "TORI", digitCount: 5 },
            warehouses: { usePrefix: false, prefix: "", digitCount: 3 },
          },
        }),
      },
      env,
    );
    expect(putRes.status).toBe(200);

    const getRes = await companySettingsRouter.request("/", {}, env);
    const body = await getRes.json();
    expect(body.master_code_formats.partners).toEqual({
      usePrefix: true,
      prefix: "TORI",
      digitCount: 5,
    });
    expect(body.master_code_formats.warehouses).toEqual({
      usePrefix: false,
      prefix: "",
      digitCount: 3,
    });
  });
});

// BUG-011: SMTP のパスワード・Slack の Bot トークンを、取得 API で返さない
describe("秘密の値(smtp_pass・slack_bot_token)", () => {
  async function put(body: Record<string, unknown>) {
    const res = await companySettingsRouter.request(
      "/",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
    expect(res.status).toBe(200);
  }

  async function stored() {
    return JSON.parse((await env.COMPANY_SETTINGS.get("config")) ?? "{}");
  }

  it("取得 API は値を空で返し、設定済みかどうかだけを返す", async () => {
    await put({ smtp_pass: "pass-1", slack_bot_token: "xoxb-1" });

    const res = await companySettingsRouter.request("/", {}, env);
    const body = await res.json();
    expect(body.smtp_pass).toBe("");
    expect(body.slack_bot_token).toBe("");
    expect(body.smtp_pass_configured).toBe(true);
    expect(body.slack_bot_token_configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("pass-1");
    expect(JSON.stringify(body)).not.toContain("xoxb-1");
  });

  it("未設定なら configured は false", async () => {
    const res = await companySettingsRouter.request("/", {}, env);
    const body = await res.json();
    expect(body.smtp_pass_configured).toBe(false);
    expect(body.slack_bot_token_configured).toBe(false);
  });

  it("空欄のまま保存すると今の値を残し、入力して保存すると置き換える", async () => {
    await put({ smtp_pass: "pass-1", slack_bot_token: "xoxb-1" });

    await put({ smtp_pass: "", slack_bot_token: "", is_pagination_enabled: true });
    expect((await stored()).smtp_pass).toBe("pass-1");
    expect((await stored()).slack_bot_token).toBe("xoxb-1");

    await put({ smtp_pass: "pass-2", slack_bot_token: "xoxb-2" });
    expect((await stored()).smtp_pass).toBe("pass-2");
    expect((await stored()).slack_bot_token).toBe("xoxb-2");
  });
});

describe("BUG-052: 承認機能の項目を送らずに保存した時", () => {
  it("承認機能はOFFとして保存され、GETもOFFを返し、実際の判定もOFF", async () => {
    const putRes = await companySettingsRouter.request(
      "/",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pagination_enabled: true }),
      },
      env,
    );
    expect(putRes.status).toBe(200);

    const body = await (await companySettingsRouter.request("/", {}, env)).json();
    expect(body.is_quote_approval_enabled).toBe(false);
    expect(body.is_partner_approval_enabled).toBe(false);
    expect(await isQuoteWorkflowGloballyEnabled(env.COMPANY_SETTINGS)).toBe(false);
  });
});
