import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { CompanySettingsService } from "./company-settings.service";

describe("Item4-e: CompanySettingsService.getSettings() 伝票単位承認フラグの移行", () => {
  beforeEach(async () => {
    await env.COMPANY_SETTINGS.delete("config");
  });

  it("KVに設定が無い場合は全伝票種別ともデフォルトtrueを返す", async () => {
    const service = new CompanySettingsService(env);
    const settings = await service.getSettings();

    expect(settings.is_quote_approval_enabled).toBe(true);
    expect(settings.is_sales_order_approval_enabled).toBe(true);
    expect(settings.is_inventory_approval_enabled).toBe(true);
  });

  it("新フィールドが既に保存されている場合はその値をそのまま使う", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ is_quote_approval_enabled: false }),
    );

    const service = new CompanySettingsService(env);
    const settings = await service.getSettings();

    expect(settings.is_quote_approval_enabled).toBe(false);
    // 未設定の他項目はデフォルトtrueのまま
    expect(settings.is_sales_approval_enabled).toBe(true);
  });

  it("旧is_document_approval_enabled(単一グローバルフラグ)しか無い場合は全伝票種別に引き継ぐ", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ is_document_approval_enabled: false }),
    );

    const service = new CompanySettingsService(env);
    const settings = await service.getSettings();

    expect(settings.is_quote_approval_enabled).toBe(false);
    expect(settings.is_sales_order_approval_enabled).toBe(false);
    expect(settings.is_purchase_order_approval_enabled).toBe(false);
    expect(settings.is_sales_approval_enabled).toBe(false);
    expect(settings.is_purchase_approval_enabled).toBe(false);
    expect(settings.is_receiving_approval_enabled).toBe(false);
    expect(settings.is_shipping_approval_enabled).toBe(false);
    expect(settings.is_inventory_approval_enabled).toBe(false);
  });

  it("さらに古いis_approval_enabledしか無い場合も引き継ぐ", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ is_approval_enabled: false }),
    );

    const service = new CompanySettingsService(env);
    const settings = await service.getSettings();

    expect(settings.is_quote_approval_enabled).toBe(false);
  });
});
