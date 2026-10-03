import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../src/db/schema";
import { parseCsvRecords } from "../../src/platform/csv/csv-parser";

/**
 * テストデータのCSVフィクスチャ読み込み。
 *
 * `test/fixtures/<シナリオ名>/<テーブル名>.csv` を、DBへ直接INSERTする(本番の取込APIは通さない)。
 * - ファイル名は実際のDBテーブル名(例: user_roles.csv)。ヘッダーはDrizzleのプロパティ名(例: employeeNumber)か、
 *   FIXTURE_LABELS の日本語名(例: 社員番号)のどちらでも書ける(業務担当者が編集する用。混在も可)。
 * - 値の型変換はDrizzleの列定義から自動: boolean=true/false/はい/いいえ、timestamp=ISO8601または日付のみ(2026-01-01)、数値、
 *   空欄=未指定(DBのデフォルト/NULL)。
 * - 未知のテーブル・列、型の不正、必須列の空欄は「ファイル名:行番号」つきのエラーにする。
 * - 投入順は外部キー順(FIXTURE_TABLES)。対応テーブルを増やす時はここに追加する。
 * 1つのテストだけ値を変えたい時は、seedFixtures の overrides で行を加工する(共有CSVは書き換えない)。
 */

/** 外部キーの親→子の順。対応するテーブルはここに並べたものだけ。 */
export const FIXTURE_TABLES = [
  "departments",
  "roles",
  "users",
  "user_roles",
  "approval_flows",
  "approval_flow_steps",
] as const;

export type FixtureTableName = (typeof FIXTURE_TABLES)[number];
export type FixtureRow = Record<string, unknown>;
export type FixtureRows = Partial<Record<FixtureTableName, FixtureRow[]>>;
export type FixtureOverrides = Partial<Record<FixtureTableName, (rows: FixtureRow[]) => FixtureRow[]>>;
export type FixtureDb = DrizzleD1Database<typeof schema>;

/** 日本語ヘッダー(別名)。テーブルごとに、列のプロパティ名→日本語名。重複しない名前にすること(整合性テストで検証) */
export const FIXTURE_LABELS: Record<FixtureTableName, Record<string, string>> = {
  departments: {
    surrogateId: "部署内部ID",
    id: "部署コード",
    name: "部署名",
    parentDepartmentSurrogateId: "親部署内部ID",
    memo: "メモ",
    validFrom: "有効開始日",
    validTo: "有効終了日",
    createdBy: "作成者",
    createdAt: "作成日時",
    updatedBy: "更新者",
    updatedAt: "更新日時",
  },
  roles: { id: "ロールID", name: "ロール名", description: "説明", createdAt: "作成日時" },
  users: {
    id: "ユーザーID",
    employeeNumber: "社員番号",
    email: "メールアドレス",
    name: "氏名",
    passwordHash: "パスワードハッシュ",
    isActive: "有効",
    slackUserId: "SlackユーザーID",
    notificationChannel: "通知方法",
    createdAt: "作成日時",
    updatedAt: "更新日時",
  },
  user_roles: { userId: "ユーザーID", roleId: "ロールID", departmentSurrogateId: "部署内部ID" },
  approval_flows: {
    id: "フローID",
    name: "フロー名",
    requestType: "申請種別",
    minAmount: "金額下限",
    maxAmount: "金額上限",
    isActive: "有効",
    matchField: "分岐項目",
    matchValue: "分岐値",
  },
  approval_flow_steps: {
    id: "ステップID",
    flowId: "フローID",
    stepOrder: "段",
    approverRoleId: "承認ロールID",
    targetDepartmentSurrogateId: "対象部署内部ID",
    stepName: "ステップ名",
    memo: "メモ",
  },
};

/** エラー表示用の列名。日本語名があれば「氏名(name)」の形にする */
function colLabel(tableName: string, prop: string): string {
  const label = (FIXTURE_LABELS as Record<string, Record<string, string> | undefined>)[tableName]?.[prop];
  return label ? `${label}(${prop})` : prop;
}

/** ヘッダー(プロパティ名または日本語名)をプロパティ名へ。該当なしは undefined */
function resolveHeader(tableName: string, header: string, columns: Record<string, unknown>): string | undefined {
  if (columns[header]) return header;
  const labels = (FIXTURE_LABELS as Record<string, Record<string, string> | undefined>)[tableName] ?? {};
  return Object.keys(labels).find((prop) => labels[prop] === header);
}

const csvFiles = import.meta.glob("../fixtures/**/*.csv", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const tableByName = new Map<string, SQLiteTable>();
for (const value of Object.values(schema)) {
  if (is(value, SQLiteTable)) tableByName.set(getTableName(value), value);
}

// D1は1文あたりバインド変数100個まで。余裕を持たせる
const MAX_BOUND_PARAMS = 90;

function parseCell(value: string, column: { dataType: string }, prop: string, where: string): unknown {
  switch (column.dataType) {
    case "string":
      return value;
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${where}: 「${prop}」は数値で指定してください(値: ${value})`);
      return n;
    }
    case "boolean": {
      const v = value.toLowerCase();
      if (v === "true" || v === "1" || v === "はい") return true;
      if (v === "false" || v === "0" || v === "いいえ") return false;
      throw new Error(`${where}: 「${prop}」は true / false(はい / いいえ)で指定してください(値: ${value})`);
    }
    case "date": {
      const d = new Date(value);
      if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(d.getTime())) {
        throw new Error(`${where}: 「${prop}」はISO8601形式で指定してください(例: 2026-01-01T00:00:00Z。値: ${value})`);
      }
      return d;
    }
    default:
      throw new Error(`${where}: 「${prop}」の型(${column.dataType})はフィクスチャ未対応です`);
  }
}

/** 1テーブル分のCSVを、検証つきで型変換した行の配列にする(DBには触れない) */
export function parseFixtureCsv(tableName: string, csvText: string, label = `${tableName}.csv`): FixtureRow[] {
  const table = tableByName.get(tableName);
  if (!table) throw new Error(`${label}: テーブル「${tableName}」がschemaにありません`);
  const columns = getTableColumns(table) as Record<string, { dataType: string; name: string; notNull: boolean; hasDefault: boolean }>;

  const records = parseCsvRecords(csvText);
  if (records.length === 0) throw new Error(`${label}: ヘッダー行がありません`);
  const [header, ...body] = records;
  const rawHeaders = header.fields.map((h) => h.trim());
  const headers = rawHeaders.map((h) => {
    const prop = resolveHeader(tableName, h, columns);
    if (!prop) {
      const labels = (FIXTURE_LABELS as Record<string, Record<string, string> | undefined>)[tableName] ?? {};
      const valid = Object.keys(columns).map((c) => (labels[c] ? `${labels[c]}(${c})` : c));
      throw new Error(`${label}: 1行目のヘッダー「${h}」は「${tableName}」の列ではありません(有効な列: ${valid.join(", ")})`);
    }
    return prop;
  });
  if (new Set(headers).size !== headers.length) throw new Error(`${label}: ヘッダーに重複があります(日本語名と英字名の同じ列を両方書いていないか確認してください)`);

  return body.map((rec) => {
    const where = `${label}:${rec.line}行目`;
    if (rec.fields.length !== headers.length) {
      throw new Error(`${where}: 列数がヘッダー(${headers.length})と一致しません(${rec.fields.length})`);
    }
    const row: FixtureRow = {};
    headers.forEach((h, i) => {
      const raw = rec.fields[i].trim();
      if (raw === "") return; // 空欄=未指定
      row[h] = parseCell(raw, columns[h], colLabel(tableName, h), where);
    });
    for (const [prop, col] of Object.entries(columns)) {
      if (col.notNull && !col.hasDefault && row[prop] === undefined) {
        throw new Error(`${where}: 必須の列「${colLabel(tableName, prop)}」が空欄です(ヘッダーに無い場合は列を追加してください)`);
      }
    }
    return row;
  });
}

/** シナリオ配下のCSVを全て読み込む(テーブル順不問。FIXTURE_TABLESに無いファイルはエラー) */
export function loadFixtureRows(scenario: string): FixtureRows {
  const prefix = `../fixtures/${scenario}/`;
  const found = Object.entries(csvFiles).filter(([path]) => path.startsWith(prefix));
  if (found.length === 0) throw new Error(`フィクスチャ「${scenario}」がありません(test/fixtures/${scenario}/*.csv)`);
  const result: FixtureRows = {};
  for (const [path, text] of found) {
    const rel = path.slice(prefix.length);
    const name = rel.replace(/\.csv$/, "");
    if (rel.includes("/") || !(FIXTURE_TABLES as readonly string[]).includes(name)) {
      throw new Error(`${scenario}/${rel}: 未対応のテーブルです。fixtures.ts の FIXTURE_TABLES に追加してください`);
    }
    result[name as FixtureTableName] = parseFixtureCsv(name, text, `${scenario}/${rel}`);
  }
  return result;
}

/** 列の組(キー集合)が同じ連続行をまとめて複数行INSERTする(省略した列にDBデフォルトを効かせるため) */
async function insertRows(db: FixtureDb, tableName: string, rows: FixtureRow[]) {
  const table = tableByName.get(tableName)!;
  let i = 0;
  while (i < rows.length) {
    const signature = Object.keys(rows[i]).sort().join("|");
    const width = Math.max(1, Object.keys(rows[i]).length);
    const maxRows = Math.max(1, Math.floor(MAX_BOUND_PARAMS / width));
    const chunk: FixtureRow[] = [];
    while (i < rows.length && chunk.length < maxRows && Object.keys(rows[i]).sort().join("|") === signature) {
      chunk.push(rows[i]);
      i++;
    }
    // テーブルはテーブル名から動的に引くため型が絞れない(値の型はparseFixtureCsvで検証済み)
    await db.insert(table as never).values(chunk as never);
  }
}

/**
 * シナリオのフィクスチャをDBへ投入する。
 * 既存データの削除はしない(各テストのbeforeEachで行う。同じPKが残っていると重複エラーになる)。
 * overrides: テーブルごとに、投入前の行を加工する関数(1テストだけ値を変える/行を除く時に使う)。
 */
export async function seedFixtures(db: FixtureDb, scenario: string, options: { overrides?: FixtureOverrides } = {}) {
  const loaded = loadFixtureRows(scenario);
  for (const name of FIXTURE_TABLES) {
    const rows = loaded[name];
    if (!rows) continue;
    const finalRows = options.overrides?.[name] ? options.overrides[name]!(rows.map((r) => ({ ...r }))) : rows;
    if (finalRows.length > 0) await insertRows(db, name, finalRows);
  }
}
