import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { mailSettingsRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 * sendEmail()の実送信(実SMTPソケット接続)が絡む成功パスはテスト環境で再現しないため対象外とし、
 * 事前ガード(400/404)の分岐のみを対象とする。
 */

async function reqJson(path: string, method: string, body?: unknown) {
  return mailSettingsRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
  );
}

describe("POST /test-email", () => {
  it("会社設定(KV)が未設定の場合は400・固定メッセージを返す", async () => {
    await env.COMPANY_SETTINGS.delete("config");

    const res = await reqJson("/test-email", "POST", {
      id: "sales_quote",
      testToEmail: "test@example.com",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "会社設定が登録されていません。管理画面の「会社設定」を保存してください。",
    });
  });

  it("帳票マスタが存在しない場合は404・固定メッセージを返す", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({
        smtp_host: "smtp.example.com",
        smtp_port: 587,
        smtp_user: "user",
        smtp_pass: "pass",
      }),
    );

    const res = await reqJson("/test-email", "POST", {
      id: "nonexistent_template",
      testToEmail: "test@example.com",
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, message: "指定された帳票マスタが存在しません" });
  });

  it("存在しないR2添付ファイルを指定した場合は400・固定メッセージを返す", async () => {
    await env.COMPANY_SETTINGS.put(
      "config",
      JSON.stringify({
        smtp_host: "smtp.example.com",
        smtp_port: 587,
        smtp_user: "user",
        smtp_pass: "pass",
      }),
    );
    // 初回GETで9個のデフォルトテンプレートが自動生成される
    await mailSettingsRouter.request("/", {}, env);

    const res = await reqJson("/test-email", "POST", {
      id: "sales_quote",
      testToEmail: "test@example.com",
      attachedR2Path: "company/nonexistent-file.pdf",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(
      "指定されたR2ファイルが見つかりません (検索対象バケット: system): company/nonexistent-file.pdf",
    );
  });
});

describe("POST /upload-file (report_template)", () => {
  it("documentTypeId未指定の場合は400", async () => {
    const formData = new FormData();
    formData.append("fileType", "report_template");
    formData.append(
      "file",
      new Blob(["dummy"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "template.xlsx",
    );

    const res = await mailSettingsRouter.request(
      "/upload-file",
      { method: "POST", body: formData },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(
      "対象の帳票種別(documentTypeId)が指定されていません",
    );
  });

  it("存在しないdocumentTypeIdの場合は404", async () => {
    const formData = new FormData();
    formData.append("fileType", "report_template");
    formData.append("documentTypeId", "nonexistent_template");
    formData.append(
      "file",
      new Blob(["dummy"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "template.xlsx",
    );

    const res = await mailSettingsRouter.request(
      "/upload-file",
      { method: "POST", body: formData },
      env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("指定された帳票マスタが存在しません");
  });

  it("正常時はR2への固定パス保存・DBのreport_template_path更新・r2-explorerでの一覧確認まですべて成功する", async () => {
    // 初回GETで9個のデフォルトテンプレートを自動生成
    await mailSettingsRouter.request("/", {}, env);

    const fileContent = "xlsx-dummy-content";
    const formData = new FormData();
    formData.append("fileType", "report_template");
    formData.append("documentTypeId", "sales_quote");
    formData.append(
      "file",
      new Blob([fileContent], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "template.xlsx",
    );

    const res = await mailSettingsRouter.request(
      "/upload-file",
      { method: "POST", body: formData },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; path: string };
    expect(body).toEqual({
      success: true,
      path: "report_templates/sales_quote.xlsx",
    });

    // R2に実際に書き込まれたことを確認
    const r2Object = await env.SYSTEM_BUCKET.get(
      "report_templates/sales_quote.xlsx",
    );
    expect(r2Object).not.toBeNull();
    expect(await r2Object!.text()).toBe(fileContent);

    // mail_template_settingsのreport_template_pathが更新されたことを確認
    const listRes = await mailSettingsRouter.request("/", {}, env);
    const templates = (await listRes.json()) as Array<{
      id: string;
      reportTemplatePath: string | null;
    }>;
    const salesQuote = templates.find((t) => t.id === "sales_quote");
    expect(salesQuote?.reportTemplatePath).toBe(
      "report_templates/sales_quote.xlsx",
    );

    // r2-explorerでreport_templates/配下に表示されることを確認
    const explorerRes = await mailSettingsRouter.request(
      "/r2-explorer?prefix=report_templates/&bucket=system",
      {},
      env,
    );
    expect(explorerRes.status).toBe(200);
    const explorerBody = (await explorerRes.json()) as {
      items: Array<{ name: string; path: string; type: string }>;
    };
    expect(explorerBody.items).toContainEqual(
      expect.objectContaining({
        name: "sales_quote.xlsx",
        path: "report_templates/sales_quote.xlsx",
        type: "file",
      }),
    );
  });
});

describe("DELETE /report-template/:documentTypeId", () => {
  it("存在しない帳票IDの場合は404", async () => {
    const res = await mailSettingsRouter.request(
      "/report-template/nonexistent_template",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("指定された帳票マスタが存在しません");
  });

  it("テンプレート未登録の場合は400", async () => {
    await mailSettingsRouter.request("/", {}, env);

    const res = await mailSettingsRouter.request(
      "/report-template/order_acknowledgement",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("この帳票にはテンプレートが登録されていません");
  });

  it("正常時はR2削除・DBのreport_template_pathクリアまで成功する", async () => {
    await mailSettingsRouter.request("/", {}, env);

    const formData = new FormData();
    formData.append("fileType", "report_template");
    formData.append("documentTypeId", "billing_invoice");
    formData.append(
      "file",
      new Blob(["dummy"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "template.xlsx",
    );
    await mailSettingsRouter.request(
      "/upload-file",
      { method: "POST", body: formData },
      env,
    );

    const res = await mailSettingsRouter.request(
      "/report-template/billing_invoice",
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body).toEqual({ success: true });

    const r2Object = await env.SYSTEM_BUCKET.get(
      "report_templates/billing_invoice.xlsx",
    );
    expect(r2Object).toBeNull();

    const listRes = await mailSettingsRouter.request("/", {}, env);
    const templates = (await listRes.json()) as Array<{
      id: string;
      reportTemplatePath: string | null;
    }>;
    const billingInvoice = templates.find((t) => t.id === "billing_invoice");
    expect(billingInvoice?.reportTemplatePath).toBeNull();
  });
});

describe("GET / (初回自動セットアップ)", () => {
  it("初回アクセス時は10件のデフォルトテンプレートを自動生成して返す", async () => {
    const res = await mailSettingsRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(10);
  });

  it("K-4-1: 一部テンプレートが既に存在する場合は不足分のみ差分シードする", async () => {
    // 事前に8件のみ存在する状態(K-4-1で追加したsales_recognitionが無い状態)を模した後、
    // getOrInitTemplates相当のGETを呼ぶと不足していたsales_recognitionのみ補完されることを確認する
    const firstRes = await mailSettingsRouter.request("/", {}, env);
    const firstBody = (await firstRes.json()) as Array<{ id: string }>;
    expect(firstBody.some((t) => t.id === "sales_recognition")).toBe(true);

    const secondRes = await mailSettingsRouter.request("/", {}, env);
    const secondBody = (await secondRes.json()) as unknown[];
    // 再アクセスしても重複生成されず10件のまま
    expect(secondBody).toHaveLength(10);
  });

  it("page/limit指定時は初回自動セットアップ込みで{data,pagination}形式で返す", async () => {
    const res = await mailSettingsRouter.request("/?page=1&limit=3", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(3);
    expect(body.pagination).toEqual({ page: 1, limit: 3, total: 10, totalPages: 4 });
  });
});

describe("追加要望L-3-b/c: 帳票PDFのファイル名プレフィックス", () => {
  async function put(body: Record<string, unknown>) {
    return mailSettingsRouter.request(
      "/",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      env,
    );
  }
  const base = { id: "sales_quote", subjectTemplate: "件名", bodyTemplate: "本文" };

  it("プレフィックスを保存でき、一覧に返る。空文字/nullで既定に戻る。省略時は変更しない", async () => {
    await mailSettingsRouter.request("/", {}, env); // 初回シード
    expect((await put({ ...base, fileNamePrefix: "御見積書" })).status).toBe(200);
    let list = (await (await mailSettingsRouter.request("/", {}, env)).json()) as Array<{ id: string; fileNamePrefix: string | null }>;
    expect(list.find((t) => t.id === "sales_quote")?.fileNamePrefix).toBe("御見積書");

    expect((await put({ ...base })).status).toBe(200); // 省略
    list = (await (await mailSettingsRouter.request("/", {}, env)).json()) as typeof list;
    expect(list.find((t) => t.id === "sales_quote")?.fileNamePrefix).toBe("御見積書");

    expect((await put({ ...base, fileNamePrefix: null })).status).toBe(200); // null=既定に戻す
    list = (await (await mailSettingsRouter.request("/", {}, env)).json()) as typeof list;
    expect(list.find((t) => t.id === "sales_quote")?.fileNamePrefix).toBeNull();
  });

  it("使用できない文字・31文字以上は400", async () => {
    await mailSettingsRouter.request("/", {}, env);
    expect((await put({ ...base, fileNamePrefix: "a/b" })).status).toBe(400);
    expect((await put({ ...base, fileNamePrefix: "a:b" })).status).toBe(400);
    expect((await put({ ...base, fileNamePrefix: "あ".repeat(31) })).status).toBe(400);
  });
});
