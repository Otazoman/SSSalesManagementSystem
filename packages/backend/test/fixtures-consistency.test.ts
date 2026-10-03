import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { FIXTURE_LABELS, FIXTURE_TABLES, loadFixtureRows, parseFixtureCsv, seedFixtures } from "./support/fixtures";

// test/fixtures/ のCSVが、現在のschemaと整合していることを検証する(schema変更でCSVが古くなったら落ちる)。
// あわせて、ローダー(型変換・エラー表示)自体の動作も確認する。
const db = drizzle(env.DB, { schema });

const scenarios = Array.from(
  new Set(
    Object.keys(import.meta.glob("./fixtures/*/*.csv")).map((p) => p.split("/")[2]),
  ),
);

async function clearAll() {
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
  await db.delete(schema.roles);
  await db.delete(schema.departments);
}

beforeEach(clearAll);

describe("フィクスチャCSV: 全シナリオの整合性", () => {
  it("シナリオが1つ以上ある", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  for (const scenario of scenarios) {
    it(`${scenario}: ヘッダー・型がschemaと一致し、外部キー順に投入できる`, async () => {
      const rows = loadFixtureRows(scenario); // ヘッダー・型・必須列の検証
      await seedFixtures(db, scenario); // 外部キー・重複PKの検証(D1は外部キーを強制する)
      const counts: Record<string, number> = {
        departments: (await db.select().from(schema.departments)).length,
        roles: (await db.select().from(schema.roles)).length,
        users: (await db.select().from(schema.users)).length,
        user_roles: (await db.select().from(schema.userRoles)).length,
        approval_flows: (await db.select().from(schema.approvalFlows)).length,
        approval_flow_steps: (await db.select().from(schema.approvalFlowSteps)).length,
      };
      for (const t of FIXTURE_TABLES) {
        expect(counts[t], `${scenario}/${t}`).toBe(rows[t]?.length ?? 0);
      }
    });
  }
});

describe("フィクスチャのローダー", () => {
  it("型変換: boolean・日時・数値・空欄(未指定)", () => {
    const [row] = parseFixtureCsv(
      "approval_flows",
      "id,name,requestType,minAmount,maxAmount,isActive,matchField\nf1,名前,t,0,100,false,\n",
    );
    expect(row).toEqual({ id: "f1", name: "名前", requestType: "t", minAmount: 0, maxAmount: 100, isActive: false });
    const [user] = parseFixtureCsv("users", "id,employeeNumber,email,name,createdAt,updatedAt\nu1,001,u1@example.com,氏名,2026-01-01T00:00:00Z,2026-01-01T00:00:00Z\n");
    expect(user.createdAt).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(user.employeeNumber).toBe("001"); // 先頭0を保つ(文字列列)
  });

  it("BOM・CRLF・引用符内のカンマ/改行を扱える", () => {
    const rows = parseFixtureCsv("roles", '\uFEFFid,name,description,createdAt\r\nr1,"a,b","1行目\n2行目",2026-01-01T00:00:00Z\r\n');
    expect(rows[0].name).toBe("a,b");
    expect(rows[0].description).toBe("1行目\n2行目");
  });

  it.each([
    ["未知の列", "roles", "id,name,createdAt,bogus\nr1,n,2026-01-01T00:00:00Z,x\n", /roles\.csv.*「bogus」.*列ではありません/],
    ["必須列が空欄", "roles", "id,name,createdAt\nr1,,2026-01-01T00:00:00Z\n", /roles\.csv:2行目.*「ロール名\(name\)」が空欄/],
    ["必須列がヘッダーに無い", "roles", "id,name\nr1,n\n", /roles\.csv:2行目.*「作成日時\(createdAt\)」が空欄/],
    ["booleanの不正値", "approval_flows", "id,name,requestType,minAmount,maxAmount,isActive\nf,n,t,0,1,yes\n", /2行目.*「有効\(isActive\)」は true \/ false/],
    ["数値の不正値", "approval_flows", "id,name,requestType,minAmount,maxAmount\nf,n,t,abc,1\n", /2行目.*「金額下限\(minAmount\)」は数値/],
    ["日時の不正値", "roles", "id,name,createdAt\nr1,n,2026/01/01\n", /2行目.*「作成日時\(createdAt\)」はISO8601/],
    ["列数の不一致", "roles", "id,name,createdAt\nr1,n\n", /2行目.*列数/],
    ["未知のテーブル", "no_such_table", "id\n1\n", /テーブル「no_such_table」がschemaにありません/],
  ])("エラー: %s", (_name, table, csv, message) => {
    expect(() => parseFixtureCsv(table, csv)).toThrow(message);
  });

  it("エラーの行番号は引用符内の改行があっても物理行で示す", () => {
    const csv = 'id,name,description,createdAt\nr1,n,"a\nb",2026-01-01T00:00:00Z\nr2,,,2026-01-01T00:00:00Z\n';
    expect(() => parseFixtureCsv("roles", csv)).toThrow(/roles\.csv:4行目/);
  });

  it("overrides: 投入前に行を加工できる(共有CSVは変わらない)", async () => {
    await seedFixtures(db, "inventory-approval", {
      overrides: {
        approval_flows: (rows) => rows.filter((r) => r.id === "flow-inventory-stock").map((r) => ({ ...r, maxAmount: 500 })),
        approval_flow_steps: (rows) => rows.filter((r) => r.flowId === "flow-inventory-stock"),
      },
    });
    const flows = await db.select().from(schema.approvalFlows);
    expect(flows).toHaveLength(1);
    expect(flows[0].maxAmount).toBe(500);
    expect(loadFixtureRows("inventory-approval").approval_flows).toHaveLength(2);
  });

  it("存在しないシナリオはエラー", () => {
    expect(() => loadFixtureRows("nothing")).toThrow(/フィクスチャ「nothing」がありません/);
  });

  it("空欄のDBデフォルト(isActive)が効く", async () => {
    await seedFixtures(db, "inventory-approval", {
      overrides: {
        approval_flows: (rows) => rows.map(({ isActive: _omit, ...rest }) => rest),
      },
    });
    const flows = await db.select().from(schema.approvalFlows);
    expect(flows.every((f) => f.isActive === true)).toBe(true);
  });
});

describe("日本語ヘッダー(業務担当者向けの別名)", () => {
  it("FIXTURE_LABELS は実在する列だけを指し、同じテーブル内で重複しない", () => {
    const tables = new Map<string, SQLiteTable>();
    for (const v of Object.values(schema)) if (is(v, SQLiteTable)) tables.set(getTableName(v), v);
    for (const [table, labels] of Object.entries(FIXTURE_LABELS)) {
      const columns = Object.keys(getTableColumns(tables.get(table)!));
      for (const prop of Object.keys(labels)) expect(columns, `${table}.${prop}`).toContain(prop);
      const names = Object.values(labels);
      expect(new Set(names).size, `${table} の日本語名が重複`).toBe(names.length);
      // 日本語名が英字の列名と衝突しない
      for (const n of names) expect(columns).not.toContain(n);
    }
  });

  it("日本語ヘッダー・英字ヘッダー・混在のどれでも同じ行になる", () => {
    const ja = parseFixtureCsv("users", "ユーザーID,社員番号,メールアドレス,氏名,有効,作成日時,更新日時\nu1,001,u1@example.com,氏名,はい,2026-01-01,2026-01-01\n");
    const en = parseFixtureCsv("users", "id,employeeNumber,email,name,isActive,createdAt,updatedAt\nu1,001,u1@example.com,氏名,true,2026-01-01T00:00:00Z,2026-01-01T00:00:00Z\n");
    const mixed = parseFixtureCsv("users", "id,社員番号,email,氏名,isActive,作成日時,updatedAt\nu1,001,u1@example.com,氏名,いいえ,2026-01-01,2026-01-01\n");
    expect(ja).toEqual(en);
    expect(mixed[0]).toEqual({ ...en[0], isActive: false });
  });

  it("同じ列を日本語名と英字名の両方で書くとエラー", () => {
    expect(() => parseFixtureCsv("roles", "id,ロールID,name,createdAt\nr1,r1,n,2026-01-01\n")).toThrow(/ヘッダーに重複/);
  });

  it("有効なヘッダーの候補が日本語名つきでエラーに出る", () => {
    expect(() => parseFixtureCsv("roles", "bogus\nx\n")).toThrow(/ロール名\(name\)/);
  });
});
