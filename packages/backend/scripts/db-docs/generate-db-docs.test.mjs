import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDocs, collectTables, describeColumn, renderErDiagram, validateCatalog } from "./generate-db-docs.mjs";
import { cleanComment, parseHelperModes, parseSchemaSource, trailingComment } from "./parse-schema-source.mjs";
import { DOMAINS } from "./catalog.mjs";

const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../docs/database");

test("台帳(catalog.mjs)に、DB の全テーブルが過不足なく登録されている", () => {
  const { tables } = collectTables();
  const { missing, extra, badDomain } = validateCatalog(Object.keys(tables));
  assert.deepEqual(missing, [], "テーブルを追加したら catalog.mjs の TABLES にも追加してください");
  assert.deepEqual(extra, [], "削除したテーブルは catalog.mjs の TABLES からも削除してください");
  assert.deepEqual(badDomain, []);
});

test("docs/database/ が最新(スキーマ・台帳を変えたら generate-db-docs.mjs を実行する)", () => {
  const files = buildDocs();
  assert.equal(Object.keys(files).length, DOMAINS.length + 1);
  for (const [file, content] of Object.entries(files)) {
    const path = resolve(DOCS_DIR, file);
    assert.ok(existsSync(path), `${file} がありません`);
    assert.equal(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), content, `${file} が古くなっています`);
  }
});

test("cleanComment: 作業履歴の札と確認履歴の括弧書きを取り除く", () => {
  assert.equal(cleanComment("Item9 Phase5: 発注書PDFのR2キー"), "発注書PDFのR2キー");
  assert.equal(cleanComment("新規要望(2026-09-23): 倉庫間移動の入庫側。"), "倉庫間移動の入庫側。");
  assert.equal(cleanComment("自社の担当者(2026-08-13ユーザー確認済み)"), "自社の担当者");
  assert.equal(cleanComment("  "), "");
});

test("trailingComment: 行末のコメントだけを取り出し、文字列の中の // は無視する", () => {
  assert.equal(trailingComment('startTime: text("start_time"), // "HH:MM" 形式'), '"HH:MM" 形式');
  assert.equal(trailingComment('url: text("url").default("https://example.com"),'), "");
});

test("parseSchemaSource: 項目のコメント(直前の行・行末)と mode を読み取る", () => {
  const source = `
export const samples = sqliteTable("samples", {
  id: text("id").primaryKey(),
  // 見本の名前
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(), // 作成日時
  isActive: integer("is_active", { mode: "boolean" }),
});`;
  const parsed = parseSchemaSource(source);
  assert.equal(parsed.samples.columns.name.comment, "見本の名前");
  assert.equal(parsed.samples.columns.created_at.comment, "作成日時");
  assert.equal(parsed.samples.columns.created_at.mode, "timestamp");
  assert.equal(parsed.samples.columns.is_active.mode, "boolean");
});

test("parseSchemaSource: 改行が CRLF のソース(Windows の取り出し)でも、直前の行のコメントを読み取る", () => {
  const source = [
    "// 見本のテーブル",
    'export const samples = sqliteTable("samples", {',
    '  id: text("id").primaryKey(),',
    "  // 見本の名前",
    '  name: text("name").notNull(),',
    '  createdAt: integer("created_at", { mode: "timestamp" }).notNull(), // 作成日時',
    "});",
  ].join("\r\n");
  const parsed = parseSchemaSource(source);
  assert.equal(parsed.samples.comment, "見本のテーブル");
  assert.equal(parsed.samples.columns.name.comment, "見本の名前");
  assert.equal(parsed.samples.columns.created_at.comment, "作成日時");
  assert.equal(parsed.samples.columns.created_at.mode, "timestamp");
});

test("parseHelperModes: 共通定義(withAuditColumns など)の項目の mode を読み取る", () => {
  const modes = parseHelperModes('createdAt: integer("created_at", { mode: "timestamp" }).notNull(),');
  assert.deepEqual(modes, { created_at: "timestamp" });
});

test("describeColumn: 個別の上書き > 共通の辞書 > ソースのコメント(変更履歴だけのコメントは使わない)", () => {
  assert.equal(describeColumn("start_time", "", "deals"), "開始時刻(HH:MM)");
  assert.equal(describeColumn("partner_id", "customer_id -> partner_id に変更"), "取引先");
  assert.equal(describeColumn("warehouse_type", "自社倉庫/外部倉庫の区分"), "自社倉庫/外部倉庫の区分");
  assert.equal(describeColumn("unknown_col", "旧名から名称変更"), "");
});

test("renderErDiagram: 外部キーを線で結び、他の領域のテーブルも表示する", () => {
  const { tables } = collectTables();
  const er = renderErDiagram("sales", tables);
  assert.match(er, /^```mermaid\nerDiagram/);
  assert.match(er, /quotes \|\|--o\{ quote_items : "quote_id"/);
  assert.match(er, /partners \{\n {4}text _other_domain/);
});
