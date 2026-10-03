import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import type { Context } from "hono";
import type { Env } from "../../types/env";
import { generateUniqueMasterCode, getMasterCodeFormatConfig } from "./resolve-master-id";

// resolve-document-id.test.tsと同じ方針(env.COMPANY_SETTINGSだけを使う最小限のContextを自前で組み立てる)
const c = { env } as unknown as Context<{ Bindings: Env }>;

beforeEach(async () => {
  await env.COMPANY_SETTINGS.delete("config");
});

describe("getMasterCodeFormatConfig", () => {
  it("会社設定が未設定の場合、種別の既定プレフィックス+4桁にフォールバックする", async () => {
    const config = await getMasterCodeFormatConfig(c, "partners");
    expect(config).toEqual({ usePrefix: true, prefix: "PT", digitCount: 4 });
  });

  it("未登録の種別キーの場合、デフォルトプレフィックス'M'+4桁にフォールバックする", async () => {
    const config = await getMasterCodeFormatConfig(c, "unknown_type");
    expect(config).toEqual({ usePrefix: true, prefix: "M", digitCount: 4 });
  });
});

describe("generateUniqueMasterCode", () => {
  it("会社設定が未設定の場合、種別のデフォルトプレフィックス+4桁で採番する", async () => {
    const id = await generateUniqueMasterCode(c, "partners", async () => false);
    expect(id).toMatch(/^PT-\d{4}$/);
  });

  it("会社設定でdigitCountを6に変更すると、番号部分がちょうど6桁になる", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({
        master_code_formats: { products: { usePrefix: true, prefix: "PRD", digitCount: 6 } },
      }),
    );
    const id = await generateUniqueMasterCode(c, "products", async () => false);
    expect(id).toMatch(/^PRD-\d{6}$/);
  });

  it("会社設定でusePrefixをfalseにすると、プレフィックスなし・番号のみで採番する", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({
        master_code_formats: { warehouses: { usePrefix: false, prefix: "WH", digitCount: 4 } },
      }),
    );
    const id = await generateUniqueMasterCode(c, "warehouses", async () => false);
    expect(id).toMatch(/^\d{4}$/);
  });

  it("生成したコードが衝突する場合、末尾に-1, -2...を付与して再試行する", async () => {
    let attempts = 0;
    const existsFn = async () => {
      attempts++;
      return attempts <= 2; // 最初の2回(通常生成+-1)は衝突、3回目(-2)で成功
    };
    const id = await generateUniqueMasterCode(c, "partners", existsFn);
    expect(id).toMatch(/^PT-\d{4}-2$/);
  });
});
