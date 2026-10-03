import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { journalExportFormatRouter } from "./index";
import { JOURNAL_EXPORT_COLUMN_KEYS } from "./journal-export-format.schema";
import { DEFAULT_JOURNAL_EXPORT_FORMAT } from "./journal-export-format.service";

beforeEach(async () => {
  await env.COMPANY_SETTINGS.delete("journal_export_format");
});

async function callGet() {
  const ctx = createExecutionContext();
  const res = await journalExportFormatRouter.request("/", {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function callPut(body: unknown) {
  const ctx = createExecutionContext();
  const res = await journalExportFormatRouter.request(
    "/",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("GET /", () => {
  it("未設定時は既定フォーマット(Item11-1と同じ列構成)を返す", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(DEFAULT_JOURNAL_EXPORT_FORMAT);
  });

  it("保存済みの設定があればそれを返す", async () => {
    const customized = {
      ...DEFAULT_JOURNAL_EXPORT_FORMAT,
      delimiter: "\t",
      dateFormat: "YYYY/MM/DD",
    };
    await callPut(customized);

    const res = await callGet();
    const body = await res.json();
    expect(body.delimiter).toBe("\t");
    expect(body.dateFormat).toBe("YYYY/MM/DD");
  });
});

describe("PUT /", () => {
  it("列の並び替え・見出し変更・列の無効化を保存できる", async () => {
    const reordered = [...DEFAULT_JOURNAL_EXPORT_FORMAT.columns].reverse().map((c) =>
      c.key === "department" ? { ...c, label: "所属部署", enabled: false } : c,
    );
    const res = await callPut({ ...DEFAULT_JOURNAL_EXPORT_FORMAT, columns: reordered });
    expect(res.status).toBe(200);

    const getRes = await callGet();
    const body = await getRes.json();
    expect(body.columns[0].key).toBe(DEFAULT_JOURNAL_EXPORT_FORMAT.columns.at(-1)?.key);
    const department = body.columns.find((c: { key: string }) => c.key === "department");
    expect(department.label).toBe("所属部署");
    expect(department.enabled).toBe(false);
  });

  it("列が不足していると400", async () => {
    const missingOne = DEFAULT_JOURNAL_EXPORT_FORMAT.columns.slice(1);
    const res = await callPut({ ...DEFAULT_JOURNAL_EXPORT_FORMAT, columns: missingOne });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("不足");
  });

  it("列が重複していると400", async () => {
    const duplicated = [...DEFAULT_JOURNAL_EXPORT_FORMAT.columns, DEFAULT_JOURNAL_EXPORT_FORMAT.columns[0]];
    const res = await callPut({ ...DEFAULT_JOURNAL_EXPORT_FORMAT, columns: duplicated });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("複数回");
  });

  it("未知の区切り文字は400(バリデーションエラー)", async () => {
    const res = await callPut({ ...DEFAULT_JOURNAL_EXPORT_FORMAT, delimiter: "|" });
    expect(res.status).toBe(400);
  });

  it("Item11-3追加列を含まない旧保存フォーマットは、GET時に既定OFFで補完され、そのままPUTし直せる", async () => {
    const legacyColumns = DEFAULT_JOURNAL_EXPORT_FORMAT.columns.filter(
      (c) => c.key !== "originalBatchId" && c.key !== "baseSourceRefId",
    );
    await env.COMPANY_SETTINGS.put(
      "journal_export_format",
      JSON.stringify({ ...DEFAULT_JOURNAL_EXPORT_FORMAT, columns: legacyColumns }),
    );

    const body = await (await callGet()).json();
    expect(body.columns).toHaveLength(JOURNAL_EXPORT_COLUMN_KEYS.length);
    const added = body.columns.filter((c: { key: string }) =>
      ["originalBatchId", "baseSourceRefId"].includes(c.key),
    );
    expect(added).toHaveLength(2);
    expect(added.every((c: { enabled: boolean }) => c.enabled === false)).toBe(true);

    const res = await callPut(body);
    expect(res.status).toBe(200);
  });

  it("固定の列キー数と既定フォーマットの列数が一致する(スキーマとサービスのずれ検知)", () => {
    expect(DEFAULT_JOURNAL_EXPORT_FORMAT.columns).toHaveLength(JOURNAL_EXPORT_COLUMN_KEYS.length);
  });
});
