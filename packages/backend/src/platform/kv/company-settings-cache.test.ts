import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { getCompanySettings } from "./company-settings-cache";

beforeEach(async () => {
  await env.COMPANY_SETTINGS.delete("config");
});

describe("getCompanySettings", () => {
  it("configキーが存在しない場合はnullを返す", async () => {
    const result = await getCompanySettings(env.COMPANY_SETTINGS);
    expect(result).toBeNull();
  });

  it("configキーが空文字の場合はnullを返す", async () => {
    await env.COMPANY_SETTINGS.put("config", "");
    const result = await getCompanySettings(env.COMPANY_SETTINGS);
    expect(result).toBeNull();
  });

  it("configキーが存在する場合はJSONとしてパースして返す", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ company_name: "テスト株式会社", is_audit_log_enabled: true }),
    );
    const result = await getCompanySettings(env.COMPANY_SETTINGS);
    expect(result).toEqual({
      company_name: "テスト株式会社",
      is_audit_log_enabled: true,
    });
  });

  it("不正なJSONの場合は例外を投げる", async () => {
    await env.COMPANY_SETTINGS.put("config", "{ invalid json");
    await expect(getCompanySettings(env.COMPANY_SETTINGS)).rejects.toThrow();
  });
});
