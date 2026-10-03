import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { progressRouter } from "./index";
import { PROGRESS_STAGE_KEYS } from "./progress.schema";

const db = drizzle(env.DB, { schema });
const now = new Date("2026-09-01T00:00:00Z");
const audit = { createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now };
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);

beforeEach(async () => {
  await db.delete(schema.progressStageOwners);
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.departments);
  await db.delete(schema.users);
  await db.insert(schema.users).values([
    { id: "user-001", employeeNumber: "EMP001", email: "emp001@example.com", name: "営業太郎", createdAt: now, updatedAt: now },
    { id: "user-002", employeeNumber: "EMP002", email: "emp002@example.com", name: "出荷花子", createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.roles).values({ id: "ROLE-SHIP", name: "出荷担当", ...audit } as never);
  await db.insert(schema.departments).values({ surrogateId: "dept-a", id: "DEPT-A", name: "営業部", validFrom: now, ...audit });
});

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await progressRouter.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function saveOwners(owners: { stageKey: string; assigneeType: string; assigneeRef: string }[]) {
  const res = await call("/stage-owners", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owners }),
  });
  expect(res.status).toBe(200);
}

async function exportCsv() {
  const res = await call("/stage-owners/csv-download");
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Excelで文字化けしないよう、UTF-8 BOM(EF BB BF)から始まる。テキスト化するとBOMは取り除かれる
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder().decode(bytes);
}

async function importCsv(text: string | null) {
  const form = new FormData();
  if (text !== null) form.append("file", new File([text], "owners.csv", { type: "text/csv" }));
  const res = await call("/stage-owners/bulk-register", { method: "POST", body: form });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const ownersInDb = async () =>
  (await db.select().from(schema.progressStageOwners))
    .map((o) => [o.stageKey, o.assigneeType, o.assigneeRef])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

const header = "stageKey,stageLabel,assigneeType,assigneeRef,assigneeName";
const csvOf = (...lines: string[]) => [header, ...lines].join(CRLF);

describe("工程ごとの担当設定のCSVダウンロード", () => {
  it("全12工程を工程順に出力し、設定済みは担当・名称つき、未設定は空欄", async () => {
    await saveOwners([
      { stageKey: "sales_order", assigneeType: "USER", assigneeRef: "EMP001" },
      { stageKey: "shipment_instruction", assigneeType: "ROLE", assigneeRef: "ROLE-SHIP" },
      { stageKey: "billing", assigneeType: "DEPT_ROLE", assigneeRef: "dept-a:ROLE-SHIP" },
    ]);

    const text = await exportCsv();

    const lines = text.trim().split(CRLF);
    expect(lines[0]).toBe(header);
    expect(lines).toHaveLength(1 + PROGRESS_STAGE_KEYS.length);
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual(PROGRESS_STAGE_KEYS.map((k) => `"${k}"`));
    expect(lines[2]).toBe('"sales_order","受注","USER","EMP001","営業太郎"');
    expect(lines[1]).toBe('"quote","見積","","",""');
    expect(lines.find((l) => l.startsWith('"shipment_instruction"'))).toBe('"shipment_instruction","出荷","ROLE","ROLE-SHIP","出荷担当"');
    // 部門+ロールは、内部IDではなく部署コード(部署マスタのid)で出力する
    expect(lines.find((l) => l.startsWith('"billing"'))).toContain('"DEPT_ROLE","DEPT-A:ROLE-SHIP"');
  });
});

describe("工程ごとの担当設定のCSV取込", () => {
  it("出力したファイルをそのまま取り込むと、同じ設定になる(ラウンドトリップ)", async () => {
    await saveOwners([
      { stageKey: "sales_order", assigneeType: "USER", assigneeRef: "EMP001" },
      { stageKey: "shipment_instruction", assigneeType: "ROLE", assigneeRef: "ROLE-SHIP" },
      { stageKey: "billing", assigneeType: "DEPT_ROLE", assigneeRef: "dept-a:ROLE-SHIP" },
    ]);
    const before = await ownersInDb();

    const { status, body } = await importCsv(await exportCsv());

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, updated: 3, cleared: 9 });
    expect(await ownersInDb()).toEqual(before);
  });

  it("編集して取り込むと反映される。担当を空欄にした工程は未設定に戻り、CSVに無い工程は変更されない", async () => {
    await saveOwners([
      { stageKey: "sales_order", assigneeType: "USER", assigneeRef: "EMP001" },
      { stageKey: "billing", assigneeType: "USER", assigneeRef: "EMP001" },
    ]);

    const { status, body } = await importCsv(
      csvOf(
        '"sales_order","受注","USER","EMP002",""', // 変更
        '"payment","支払","ROLE","ROLE-SHIP",""', // 新規設定
        '"quote","見積","",""', // 未設定のまま(空欄=解除)
      ),
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ updated: 2, cleared: 1 });
    expect(await ownersInDb()).toEqual([
      ["billing", "USER", "EMP001"], // CSVに無いので変更なし
      ["payment", "ROLE", "ROLE-SHIP"],
      ["sales_order", "USER", "EMP002"],
    ]);
  });

  it("担当を空欄にした工程は、設定済みでも未設定に戻る", async () => {
    await saveOwners([{ stageKey: "billing", assigneeType: "USER", assigneeRef: "EMP001" }]);

    const { body } = await importCsv(csvOf('"billing","請求","","",""'));

    expect(body).toMatchObject({ updated: 0, cleared: 1 });
    expect(await ownersInDb()).toEqual([]);
  });

  it("参考列(stageLabel・assigneeName)が無い最小形式(stageKey,assigneeType,assigneeRef)も取り込める", async () => {
    const { status } = await importCsv(["stageKey,assigneeType,assigneeRef", "quote,USER,EMP001"].join(CRLF));

    expect(status).toBe(200);
    expect(await ownersInDb()).toEqual([["quote", "USER", "EMP001"]]);
  });

  it("不正な行は行番号つきでまとめて報告され、1件も反映されない", async () => {
    await saveOwners([{ stageKey: "billing", assigneeType: "USER", assigneeRef: "EMP001" }]);

    const { status, body } = await importCsv(
      csvOf(
        '"quote","見積","USER","EMP002",""',
        '"nope","?","USER","EMP001",""',
        '"sales_order","受注","ALIEN","EMP001",""',
        '"purchase_order","発注","USER","",""',
        '"payment","支払","DEPT_ROLE","dept-a",""',
        '"quote","見積","USER","EMP001",""',
      ),
    );

    expect(status).toBe(400);
    expect(body.message).toContain("3行目: stageKey「nope」は工程キーではありません");
    expect(body.message).toContain("4行目: assigneeTypeは");
    expect(body.message).toContain("5行目: assigneeRef");
    expect(body.message).toContain("6行目: DEPT_ROLEのassigneeRefは「部署コード:ロールID」");
    expect(body.message).toContain("7行目: 工程「quote」がCSV内で重複しています");
    expect(await ownersInDb()).toEqual([["billing", "USER", "EMP001"]]);
  });

  it("存在しないユーザー・ロール・部署は400で、1件も反映されない", async () => {
    const noUser = await importCsv(csvOf('"quote","見積","USER","EMP999",""'));
    const noRole = await importCsv(csvOf('"quote","見積","ROLE","ROLE-NOPE",""'));
    const noDept = await importCsv(csvOf('"quote","見積","DEPT_ROLE","dept-x:ROLE-SHIP",""'));

    expect(noUser.status).toBe(400);
    expect(noUser.body.message).toContain("EMP999");
    expect(noRole.status).toBe(400);
    expect(noDept.status).toBe(400);
    expect(noDept.body.message).toContain("dept-x");
    expect(await ownersInDb()).toEqual([]);
  });

  it("ファイル未添付・ヘッダー不正・データ行なしは400", async () => {
    expect((await importCsv(null)).status).toBe(400);
    const badHeader = await importCsv("a,b,c\n1,2,3");
    expect(badHeader.status).toBe(400);
    expect(badHeader.body.message).toContain("CSVヘッダー書式が正しくありません");
    const empty = await importCsv(header);
    expect(empty.status).toBe(400);
    expect(empty.body.message).toContain("取り込むデータ行がありません");
  });
});

describe("工程ごとの担当設定のCSV: 部署+ロールは部署コードで指定する", () => {
  const surrogateOf = async (stageKey: string) =>
    (await db.select().from(schema.progressStageOwners)).find((o) => o.stageKey === stageKey)?.assigneeRef;

  it("部署コード(部署マスタのid)で指定して取り込める。保存は部署の内部IDに変換される", async () => {
    const { status } = await importCsv(csvOf('"billing","請求","DEPT_ROLE","DEPT-A:ROLE-SHIP",""'));

    expect(status).toBe(200);
    expect(await surrogateOf("billing")).toBe("dept-a:ROLE-SHIP");
  });

  it("内部IDで指定しても取り込める(従来の形式との互換)", async () => {
    const { status } = await importCsv(csvOf('"billing","請求","DEPT_ROLE","dept-a:ROLE-SHIP",""'));

    expect(status).toBe(200);
    expect(await surrogateOf("billing")).toBe("dept-a:ROLE-SHIP");
  });

  it("出力したCSVを取り込み直しても、部署コードのまま同じ設定になる(ラウンドトリップ)", async () => {
    await saveOwners([{ stageKey: "billing", assigneeType: "DEPT_ROLE", assigneeRef: "dept-a:ROLE-SHIP" }]);

    const text = await exportCsv();
    expect(text).toContain("DEPT-A:ROLE-SHIP");
    const { status } = await importCsv(text);

    expect(status).toBe(200);
    expect(await surrogateOf("billing")).toBe("dept-a:ROLE-SHIP");
  });

  it("存在しない部署コードは行番号つきで400。有効期間が終了した部署だけのコードも受け付けない", async () => {
    await db.insert(schema.departments).values({
      surrogateId: "dept-old", id: "DEPT-OLD", name: "旧部署", validFrom: new Date("2020-04-01T00:00:00Z"), validTo: new Date("2021-03-31T00:00:00Z"), ...audit,
    });

    const noDept = await importCsv(csvOf('"billing","請求","DEPT_ROLE","NOPE:ROLE-SHIP",""'));
    const expired = await importCsv(csvOf('"quote","見積","USER","EMP001",""', '"billing","請求","DEPT_ROLE","DEPT-OLD:ROLE-SHIP",""'));

    expect(noDept.status).toBe(400);
    expect(noDept.body.message).toContain("2行目: 部署コード「NOPE」の有効な部署が見つかりません");
    expect(expired.status).toBe(400);
    expect(expired.body.message).toContain("3行目: 部署コード「DEPT-OLD」");
    expect(await ownersInDb()).toEqual([]);
  });

  it("同じ部署コードに複数の有効期間がある場合は、現在有効なものを使う(終了済み・未来開始は選ばない)", async () => {
    await db.insert(schema.departments).values([
      { surrogateId: "dept-m-expired", id: "DEPT-M", name: "旧", validFrom: new Date("2020-04-01T00:00:00Z"), validTo: new Date("2024-03-31T00:00:00Z"), ...audit },
      { surrogateId: "dept-m-current", id: "DEPT-M", name: "現", validFrom: new Date("2025-04-01T00:00:00Z"), ...audit },
      { surrogateId: "dept-m-future", id: "DEPT-M", name: "未来", validFrom: new Date("2999-01-01T00:00:00Z"), ...audit },
    ]);

    const { status } = await importCsv(csvOf('"billing","請求","DEPT_ROLE","DEPT-M:ROLE-SHIP",""'));

    expect(status).toBe(200);
    expect(await surrogateOf("billing")).toBe("dept-m-current:ROLE-SHIP");
  });
});
