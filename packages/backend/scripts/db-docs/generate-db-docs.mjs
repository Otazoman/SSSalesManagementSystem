#!/usr/bin/env node
// DB のドキュメント(docs/database/)を自動生成する。
//
// 情報源:
//   - drizzle-kit のスナップショット(drizzle/{DB}/meta/*_snapshot.json): テーブル・項目・型・必須・既定値・外部キー・一意制約
//     (migration と必ず一致する。TypeScript を実行せずに読める)
//   - スキーマのソース(src/db/**): 項目の説明(コメント)と、日時・真偽値などの種類(mode)
//   - 台帳(catalog.mjs): テーブルの日本語名・説明・業務の領域、項目の共通の説明
//
// 使い方(リポジトリのルートから):
//   node packages/backend/scripts/db-docs/generate-db-docs.mjs           # docs/database/ を生成(上書き)
//   node packages/backend/scripts/db-docs/generate-db-docs.mjs --check   # 最新かどうかの確認だけ(古ければ終了コード1)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COLUMN_DICTIONARY, COLUMN_OVERRIDES, DOMAINS, TABLES } from "./catalog.mjs";
import { parseHelperModes, parseSchemaSource } from "./parse-schema-source.mjs";

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = resolve(BACKEND_ROOT, "../..");
const OUTPUT_DIR = resolve(REPO_ROOT, "docs/database");

/** DB(D1 バインディング)ごとの migration のフォルダとスキーマのソース */
export const DATABASES = [
  { binding: "DB", name: "my-erp-db", dir: "main", label: "業務データ", sources: ["src/db/schemas/schema-core.ts", "src/db/schemas/schema-workflow.ts", "src/db/schemas/schema-biz.ts"] },
  { binding: "DB_LOG", name: "my-erp-log-db", dir: "log", label: "監査ログ・メール送信ログ", sources: ["src/db/audit-schema.ts"] },
  { binding: "DB_OTP", name: "my-erp-otp-db", dir: "otp", label: "OTP", sources: ["src/db/otp-schema.ts"] },
  { binding: "DB_JOURNAL", name: "my-erp-journal-db", dir: "journal", label: "仕訳データ", sources: ["src/db/journal-schema.ts"] },
  { binding: "DB_DEALS", name: "my-erp-deals-db", dir: "deals", label: "商談", sources: ["src/db/deals-schema.ts"] },
  { binding: "DB_UI", name: "my-erp-ui-db", dir: "ui", label: "お知らせ・画面説明・表示設定", sources: ["src/db/ui-schema.ts"] },
];

/** 最新のスナップショット(migration journal の最後のエントリ)のテーブル一覧 */
export function loadSnapshotTables(backendRoot, dir) {
  const metaDir = resolve(backendRoot, "drizzle", dir, "meta");
  const journal = JSON.parse(readFileSync(resolve(metaDir, "_journal.json"), "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  const snapshotPath = resolve(metaDir, `${String(last.idx).padStart(4, "0")}_snapshot.json`);
  return { tables: JSON.parse(readFileSync(snapshotPath, "utf8")).tables, migration: last.tag };
}

/** 全 DB のテーブルを { テーブル名: { db, snapshot, source } } にまとめる */
export function collectTables(backendRoot = BACKEND_ROOT) {
  const result = {};
  const migrations = {};
  // 共通定義(withAuditColumns() など)から展開される項目の種類(created_at = 日時 など)
  const helperModes = parseHelperModes(readFileSync(resolve(backendRoot, "src/db/schemas/schema-helpers.ts"), "utf8"));
  for (const db of DATABASES) {
    const { tables, migration } = loadSnapshotTables(backendRoot, db.dir);
    migrations[db.binding] = migration;
    const source = {};
    for (const file of db.sources) Object.assign(source, parseSchemaSource(readFileSync(resolve(backendRoot, file), "utf8")));
    for (const [name, snapshot] of Object.entries(tables)) {
      const tableSource = source[name] ?? { comment: "", columns: {} };
      for (const [column, mode] of Object.entries(helperModes)) {
        if (snapshot.columns[column] && !tableSource.columns[column]) tableSource.columns[column] = { comment: "", mode };
      }
      result[name] = { db, snapshot, source: tableSource };
    }
  }
  return { tables: result, migrations };
}

/** 台帳とスナップショットの食い違い(台帳に無いテーブル・存在しないテーブル・不明な領域) */
export function validateCatalog(tableNames) {
  const domainKeys = new Set(DOMAINS.map((d) => d.key));
  const missing = tableNames.filter((t) => !TABLES[t]);
  const extra = Object.keys(TABLES).filter((t) => !tableNames.includes(t));
  const badDomain = Object.entries(TABLES)
    .filter(([, info]) => !domainKeys.has(info.domain))
    .map(([t]) => t);
  return { missing, extra, badDomain };
}

function typeLabel(column, mode) {
  if (mode === "timestamp" || mode === "timestamp_ms") return "日時";
  if (mode === "boolean") return "真偽値";
  if (mode === "json") return "JSON";
  return { text: "文字列", integer: "整数", real: "数値", blob: "バイナリ", numeric: "数値" }[column.type] ?? column.type;
}

function defaultLabel(value) {
  if (value === undefined || value === null) return "";
  const text = String(value).replace(/^'(.*)'$/, "$1");
  return `\`${text}\``;
}

function foreignKeysByColumn(snapshot) {
  const map = {};
  for (const fk of Object.values(snapshot.foreignKeys ?? {})) {
    fk.columnsFrom.forEach((col, i) => {
      map[col] = { table: fk.tableTo, column: fk.columnsTo[i] };
    });
  }
  return map;
}

function tableLink(tableName, fromDomainKey) {
  const info = TABLES[tableName];
  const domain = DOMAINS.find((d) => d.key === info?.domain);
  if (!domain) return `\`${tableName}\``;
  const file = domain.key === fromDomainKey ? "" : domain.file;
  return `[${tableName}](${file}#${tableName})`;
}

// 変更履歴だけのコメント(「customer_id -> partner_id に変更」など)は説明として使わない
const HISTORY_ONLY_COMMENT = /->|→|に変更|から変更|リネーム|名称変更/;

/**
 * 項目の説明。利用者に分かりやすい共通の辞書(catalog.mjs)を優先し、辞書に無い項目だけ
 * スキーマのソースのコメントを使う(ソースのコメントは開発者向けの注記を含むことが多いため)
 */
export function describeColumn(columnName, sourceComment, tableName = "") {
  if (COLUMN_OVERRIDES[`${tableName}.${columnName}`]) return COLUMN_OVERRIDES[`${tableName}.${columnName}`];
  if (COLUMN_DICTIONARY[columnName]) return COLUMN_DICTIONARY[columnName];
  if (sourceComment && !HISTORY_ONLY_COMMENT.test(sourceComment)) return sourceComment;
  return "";
}

function escapeCell(text) {
  return String(text).replace(/\|/g, "／").replace(/\r?\n/g, " ");
}

/** 領域の ER 図(Mermaid)。主キー・外部キーの項目だけを描く */
export function renderErDiagram(domainKey, tables) {
  const own = Object.keys(tables).filter((t) => TABLES[t]?.domain === domainKey).sort();
  const lines = ["```mermaid", "erDiagram"];
  const relations = [];
  const external = new Set();
  for (const name of own) {
    const { snapshot, source } = tables[name];
    const fks = foreignKeysByColumn(snapshot);
    const attrs = [];
    for (const col of Object.values(snapshot.columns)) {
      const isPk = col.primaryKey || Object.values(snapshot.compositePrimaryKeys ?? {}).some((pk) => pk.columns.includes(col.name));
      const fk = fks[col.name];
      if (!isPk && !fk) continue;
      const mode = source.columns[col.name]?.mode;
      const type = mode === "timestamp" ? "datetime" : col.type;
      attrs.push(`    ${type} ${col.name}${isPk && fk ? " PK,FK" : isPk ? " PK" : " FK"}`);
      if (fk) {
        relations.push(`  ${fk.table} ${col.notNull ? "||" : "|o"}--o{ ${name} : "${col.name}"`);
        if (TABLES[fk.table]?.domain !== domainKey) external.add(fk.table);
      }
    }
    lines.push(`  ${name} {`, ...(attrs.length ? attrs : ["    text _"]), "  }");
  }
  for (const name of [...external].sort()) lines.push(`  ${name} {`, "    text _other_domain", "  }");
  lines.push(...relations, "```");
  return lines.join("\n");
}

/** 1テーブル分の説明(項目表・一意制約・インデックス) */
export function renderTable(name, table, domainKey) {
  const { db, snapshot, source } = table;
  const info = TABLES[name];
  const fks = foreignKeysByColumn(snapshot);
  const compositePk = Object.values(snapshot.compositePrimaryKeys ?? {}).flatMap((pk) => pk.columns);
  const out = [];
  out.push(`<a id="${name}"></a>`, "", `### ${name}(${info.label})`, "");
  out.push(`${info.description}`, "");
  out.push(`- DB: \`${db.binding}\``, "");
  out.push("| 項目 | 型 | 必須 | 既定値 | 参照先 | 説明 |", "|---|---|:---:|---|---|---|");
  for (const col of Object.values(snapshot.columns)) {
    const src = source.columns[col.name] ?? {};
    const isPk = col.primaryKey || compositePk.includes(col.name);
    const fk = fks[col.name];
    const description = describeColumn(col.name, src.comment, name);
    out.push(
      `| ${isPk ? "🔑 " : ""}\`${col.name}\` | ${typeLabel(col, src.mode)} | ${col.notNull ? "○" : ""} | ${defaultLabel(col.default)} | ${
        fk ? `${tableLink(fk.table, domainKey)}.${fk.column}` : ""
      } | ${escapeCell(description)} |`,
    );
  }
  const uniques = Object.values(snapshot.uniqueConstraints ?? {}).map((u) => u.columns);
  const uniqueIndexes = Object.values(snapshot.indexes ?? {}).filter((i) => i.isUnique).map((i) => i.columns);
  const allUniques = [...uniques, ...uniqueIndexes];
  if (compositePk.length) out.push("", `- 主キー(複合): ${compositePk.map((c) => `\`${c}\``).join(" + ")}`);
  if (allUniques.length) out.push("", `- 一意(重複不可): ${allUniques.map((cols) => cols.map((c) => `\`${c}\``).join(" + ")).join("、")}`);
  return out.join("\n");
}

const GENERATED_NOTE =
  "> このファイルは `packages/backend/scripts/db-docs/generate-db-docs.mjs` で自動生成しています。直接編集しないでください(更新方法は [DB 構造の概要](README.md#更新方法))。";

export function renderDomainFile(domain, tables) {
  const own = Object.keys(tables).filter((t) => TABLES[t]?.domain === domain.key).sort();
  const out = [`# DB 構造: ${domain.title}`, "", GENERATED_NOTE, "", `${domain.description}。`, ""];
  out.push("## テーブル一覧", "", "| テーブル | 名前 | DB | 説明 |", "|---|---|---|---|");
  for (const name of own) {
    out.push(`| [${name}](#${name}) | ${TABLES[name].label} | \`${tables[name].db.binding}\` | ${escapeCell(TABLES[name].description)} |`);
  }
  out.push("", "## ER 図", "", "主キー(PK)と外部キー(FK)の項目だけを表示しています。`_other_domain` は他の領域のテーブルです。", "");
  out.push(renderErDiagram(domain.key, tables), "");
  out.push("## テーブルの詳細", "", "🔑 = 主キー、必須の ○ = 空にできない項目です。", "");
  for (const name of own) out.push(renderTable(name, tables[name], domain.key), "");
  return `${out.join("\n").trimEnd()}\n`;
}

export function renderReadme(tables, migrations) {
  const out = ["# DB 構造", "", GENERATED_NOTE.replace("(更新方法は [DB 構造の概要](README.md#更新方法))", "(更新方法は下の「更新方法」)"), ""];
  out.push(
    "販売管理システムのデータベース(Cloudflare D1)の構造です。性格の違うデータを6つの DB に分けています。",
    "全体の構成は [全体設計](../architecture/overview.md) を参照してください。",
    "",
    "## DB の一覧",
    "",
    "| バインディング | 本番の DB 名 | 内容 | テーブル数 | 最新の migration |",
    "|---|---|---|---:|---|",
  );
  for (const db of DATABASES) {
    const count = Object.values(tables).filter((t) => t.db.binding === db.binding).length;
    out.push(`| \`${db.binding}\` | \`${db.name}\` | ${db.label} | ${count} | \`${migrations[db.binding]}\` |`);
  }
  out.push("", "> Staging では、`DB` 以外の5つを1つの物理 DB(`my-erp-shared-db-staging`)にまとめています。テーブル名は重複していません。", "");
  out.push("## 業務の領域ごとのドキュメント", "", "各ドキュメントに、ER 図とテーブル・項目の説明があります。", "", "| 領域 | 内容 | テーブル数 |", "|---|---|---:|");
  for (const domain of DOMAINS) {
    const count = Object.keys(tables).filter((t) => TABLES[t]?.domain === domain.key).length;
    out.push(`| [${domain.title}](${domain.file}) | ${domain.description} | ${count} |`);
  }
  out.push("", "## テーブルの索引", "", "| テーブル | 名前 | 領域 | DB |", "|---|---|---|---|");
  for (const name of Object.keys(tables).sort()) {
    const domain = DOMAINS.find((d) => d.key === TABLES[name].domain);
    out.push(`| [${name}](${domain.file}#${name}) | ${TABLES[name].label} | ${domain.title} | \`${tables[name].db.binding}\` |`);
  }
  out.push(
    "",
    "## 共通のきまり",
    "",
    "- **日時**は Unix 時刻(秒)の整数で保存しています(Drizzle の `mode: \"timestamp\"`)。表の型が「日時」の項目です。",
    "- **真偽値**は 0 / 1 の整数で保存しています(Drizzle の `mode: \"boolean\"`)。",
    "- **作成者・更新者**(`created_by`・`updated_by`)は、多くのテーブルで従業員番号を保存しています。",
    "- **状態**(`status`)は、マスタでは `temporary`(仮登録)・`active`(有効)・`suspended`(無効)、伝票では `UNAPPROVED`(承認申請中)・`APPROVED`(承認済み)・`REMANDED`(差戻し)などを使います。",
    "- **添付ファイル**の実体は R2 に保存し、テーブルには保存先のキー(`*_r2_path`)を持ちます。",
    "- 別の DB にあるテーブル(例: 商談から見積)への参照には、外部キーを付けていません。",
    "",
    "## 更新方法",
    "",
    "DB のスキーマ(`packages/backend/src/db/`)を変更し、migration を生成した後に、次のコマンドでこのドキュメントを作り直します。",
    "",
    "```bash",
    "# リポジトリのルートで",
    "node packages/backend/scripts/db-docs/generate-db-docs.mjs          # docs/database/ を作り直す",
    "node packages/backend/scripts/db-docs/generate-db-docs.mjs --check  # 最新かどうかの確認だけ",
    "```",
    "",
    "- テーブルを追加したときは、`packages/backend/scripts/db-docs/catalog.mjs` の `TABLES` に、日本語名・説明・領域を1行追加します(無いとエラーになります)。",
    "- 項目の説明は、スキーマのソースで項目の直前(または同じ行)に書いたコメントが使われます。コメントが無い項目は、`catalog.mjs` の `COLUMN_DICTIONARY` の共通の説明が使われます。",
    "- スクリプトのテスト: `node --test packages/backend/scripts/db-docs/generate-db-docs.test.mjs`",
  );
  return `${out.join("\n")}\n`;
}

/** 生成するファイル: { 相対パス: 内容 } */
export function buildDocs(backendRoot = BACKEND_ROOT) {
  const { tables, migrations } = collectTables(backendRoot);
  const { missing, extra, badDomain } = validateCatalog(Object.keys(tables));
  if (missing.length || extra.length || badDomain.length) {
    const lines = [];
    if (missing.length) lines.push(`catalog.mjs の TABLES に無いテーブル: ${missing.join(", ")}`);
    if (extra.length) lines.push(`catalog.mjs の TABLES にあるが DB に無いテーブル: ${extra.join(", ")}`);
    if (badDomain.length) lines.push(`領域(domain)が DOMAINS に無いテーブル: ${badDomain.join(", ")}`);
    throw new Error(lines.join("\n"));
  }
  const files = { "README.md": renderReadme(tables, migrations) };
  for (const domain of DOMAINS) files[domain.file] = renderDomainFile(domain, tables);
  return files;
}

function main() {
  const check = process.argv.includes("--check");
  const files = buildDocs();
  const stale = Object.entries(files).filter(([file, content]) => {
    const path = resolve(OUTPUT_DIR, file);
    return !existsSync(path) || readFileSync(path, "utf8").replace(/\r\n/g, "\n") !== content;
  });
  if (check) {
    if (stale.length === 0) {
      console.log("docs/database/ は最新です。");
      return;
    }
    console.error(`docs/database/ が古くなっています(${stale.map(([f]) => f).join(", ")})。generate-db-docs.mjs を実行してください。`);
    process.exit(1);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const [file, content] of stale) writeFileSync(resolve(OUTPUT_DIR, file), content);
  console.log(stale.length ? `更新しました: ${stale.map(([f]) => f).join(", ")}` : "変更はありません。");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`エラー: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
