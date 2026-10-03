import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { CompanySettingsService } from "./company-settings.service";
import {
  isPartnerWorkflowGloballyEnabled,
  isQuoteWorkflowGloballyEnabled,
} from "../../../workflow-engine/settings";

describe("Item4-e: CompanySettingsService.getSettings() 伝票単位承認フラグの移行", () => {
  beforeEach(async () => {
    await env.COMPANY_SETTINGS.delete("config");
  });

  // BUG-052: 実際の判定(workflow-engine/settings.ts)は保存値が true の時だけ有効とするため、
  // 画面・API の表示も「保存されていなければ OFF」に揃えた(以前はデフォルト true と表示していた)
  it("KVに設定が無い場合は全伝票種別ともOFF(false)を返す", async () => {
    const service = new CompanySettingsService(env);
    const settings = await service.getSettings();

    expect(settings.is_quote_approval_enabled).toBe(false);
    expect(settings.is_sales_order_approval_enabled).toBe(false);
    expect(settings.is_inventory_approval_enabled).toBe(false);
  });

  it("新フィールドが既に保存されている場合はその値をそのまま使う", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ is_quote_approval_enabled: false }),
    );

    const service = new CompanySettingsService(env);
    const settings = await service.getSettings();

    expect(settings.is_quote_approval_enabled).toBe(false);
    // BUG-052: 未設定の他項目はOFF(実際の判定と同じ)
    expect(settings.is_sales_approval_enabled).toBe(false);
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

describe("BUG-052: 承認機能の設定は、画面・APIの表示と実際の判定が一致する", () => {
  beforeEach(async () => {
    await env.COMPANY_SETTINGS.delete("config");
  });

  const approvalKeysOf = (settings: Record<string, unknown>) =>
    Object.keys(settings).filter((key) => key.endsWith("_approval_enabled"));

  it("設定が一度も保存されていない時は、全ての承認機能をOFFと表示し、実際の判定もOFF", async () => {
    const settings = (await new CompanySettingsService(env).getSettings()) as Record<string, unknown>;

    const keys = approvalKeysOf(settings);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) expect(settings[key], key).toBe(false);
    expect(await isQuoteWorkflowGloballyEnabled(env.COMPANY_SETTINGS)).toBe(false);
    expect(await isPartnerWorkflowGloballyEnabled(env.COMPANY_SETTINGS)).toBe(false);
  });

  it("一部の項目だけ保存されている時は、保存されていない項目をOFFと表示する", async () => {
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ company_name: "テスト" }));

    const settings = (await new CompanySettingsService(env).getSettings()) as Record<string, unknown>;

    for (const key of approvalKeysOf(settings)) expect(settings[key], key).toBe(false);
    expect(await isQuoteWorkflowGloballyEnabled(env.COMPANY_SETTINGS)).toBe(false);
  });

  it("true(文字列の\"true\"も含む)で保存された項目はONと表示し、実際の判定もON", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({ is_quote_approval_enabled: true, is_partner_approval_enabled: "true" }),
    );

    const settings = await new CompanySettingsService(env).getSettings();

    expect(settings.is_quote_approval_enabled).toBe(true);
    expect(settings.is_partner_approval_enabled).toBe(true);
    expect(await isQuoteWorkflowGloballyEnabled(env.COMPANY_SETTINGS)).toBe(true);
    expect(await isPartnerWorkflowGloballyEnabled(env.COMPANY_SETTINGS)).toBe(true);
  });

  it("古い設定項目(is_document_approval_enabled)がtrueでも、新しい項目が無ければOFF(実際の判定と同じ)", async () => {
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({ is_document_approval_enabled: true, is_approval_enabled: true }));

    const settings = await new CompanySettingsService(env).getSettings();

    expect(settings.is_quote_approval_enabled).toBe(false);
    expect(settings.is_partner_approval_enabled).toBe(false);
    expect(await isQuoteWorkflowGloballyEnabled(env.COMPANY_SETTINGS)).toBe(false);
  });
});
