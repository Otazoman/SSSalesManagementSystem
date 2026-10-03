import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import type { Context } from "hono";
import type { Env } from "../../types/env";
import { resolveConfiguredDocumentId } from "./resolve-document-id";

// このユニットテストではHonoアプリを経由せず、env.COMPANY_SETTINGSだけを使う最小限のContextを
// 自前で組み立てて直接関数を呼ぶ(resolveConfiguredDocumentIdはc.env.COMPANY_SETTINGSしか参照しないため)
const c = { env } as unknown as Context<{ Bindings: Env }>;

beforeEach(async () => {
  await env.COMPANY_SETTINGS.delete("config");
});

describe("resolveConfiguredDocumentId", () => {
  it("会社設定が未設定の場合、種別のデフォルトプレフィックス+4桁で採番する(日付部分は含まない)", async () => {
    const id = await resolveConfiguredDocumentId(c, "sales_order", async () => false, null);
    expect(id).toMatch(/^SO-\d{4}$/);
  });

  it("未登録の種別キーの場合、デフォルトプレフィックス'DOC'+4桁で採番する", async () => {
    const id = await resolveConfiguredDocumentId(c, "unknown_type", async () => false, null);
    expect(id).toMatch(/^DOC-\d{4}$/);
  });

  it("会社設定でdigitCountを8に変更すると、番号部分がちょうど8桁になる(日付部分と重複しない)", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({
        document_number_formats: { sales_order: { usePrefix: true, prefix: "SO", digitCount: 8 } },
      }),
    );
    const id = await resolveConfiguredDocumentId(c, "sales_order", async () => false, null);
    expect(id).toMatch(/^SO-\d{8}$/);
  });

  it("会社設定でusePrefixをfalseにすると、プレフィックスなし・番号のみで採番する", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({
        document_number_formats: { audit: { usePrefix: false, prefix: "TK", digitCount: 4 } },
      }),
    );
    const id = await resolveConfiguredDocumentId(c, "audit", async () => false, null);
    expect(id).toMatch(/^\d{4}$/);
  });

  it("candidateIdが指定され未使用であれば、そのまま採用する", async () => {
    const id = await resolveConfiguredDocumentId(c, "quote", async () => false, "QT-CUSTOM-1");
    expect(id).toBe("QT-CUSTOM-1");
  });

  it("candidateIdが既に使用済みの場合、通常のフォーマット採番にフォールバックする", async () => {
    const id = await resolveConfiguredDocumentId(
      c,
      "quote",
      async (checkId) => checkId === "QT-DUP",
      "QT-DUP",
    );
    expect(id).toMatch(/^QT-\d{4}$/);
  });

  it("生成したIDが衝突する場合、末尾に-1, -2...を付与して再試行する", async () => {
    let attempts = 0;
    const existsFn = async () => {
      attempts++;
      return attempts <= 2; // 最初の2回(通常生成+-1)は衝突、3回目(-2)で成功
    };
    const id = await resolveConfiguredDocumentId(c, "sales_order", existsFn, null);
    expect(id).toMatch(/^SO-\d{4}-2$/);
  });
});
