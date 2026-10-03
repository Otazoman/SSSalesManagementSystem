import { Context } from "hono";
import { Env } from "../../../types/env";
import {
  D1_DATABASE_REGISTRY,
  DEFAULT_PAGE_SIZE,
  MASKED_COLUMN_PATTERN,
  MAX_CELL_LENGTH,
  MAX_OFFSET,
  MAX_PAGE_SIZE,
  WRITE_PROTECTED_TABLES,
  resolveD1,
} from "./d1-explorer.constants";
import {
  D1RowQuery,
  D1TableQuery,
  DeleteD1RowPayload,
  ListD1RowsQuery,
  ListD1TablesQuery,
  UpdateD1RowPayload,
} from "./d1-explorer.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

const RESOURCE_KEY = "admin_d1_explorer";

type RowKey = Record<string, string | number>;

// Item13-b: D1参照・編集機能。当初は閲覧のみだったが、2026-09-20のユーザー要望で
// 「主キー指定の1行の更新・削除」を追加(DDLは引き続き行わない)。
// ユーザー入力のSQLは一切受け付けず、固定形のSELECT/PRAGMA/UPDATE/DELETEのみを発行する。
// テーブル名・列名は必ずスキーマ上に実在する名前と照合してから識別子としてクオートする(SQLインジェクション防止)
export class D1ExplorerService {
  listDatabases(env: Env) {
    return D1_DATABASE_REGISTRY.filter((d) => !!env[d.binding]).map((d) => ({
      key: d.key,
      label: d.label,
      writable: d.writable,
    }));
  }

  private getDb(c: Context<{ Bindings: Env }>, key: string): D1Database {
    const db = resolveD1(c.env, key);
    if (!db) throw new BadRequestError(`対象DBが利用できません: ${key}`);
    return db;
  }

  private async listTableNames(db: D1Database): Promise<{ name: string; type: string }[]> {
    const result = await db
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
         ORDER BY name`,
      )
      .all<{ name: string; type: string }>();
    return result.results;
  }

  private async findTable(db: D1Database, table: string) {
    const found = (await this.listTableNames(db)).find((t) => t.name === table);
    if (!found) throw new NotFoundError(`テーブルが見つかりません: ${table}`);
    return found;
  }

  private quoteIdentifier(name: string) {
    return `"${name.replace(/"/g, '""')}"`;
  }

  private isDbWritable(key: string) {
    return D1_DATABASE_REGISTRY.find((d) => d.key === key)?.writable === true;
  }

  async listTables(c: Context<{ Bindings: Env }>, query: ListD1TablesQuery) {
    return this.listTableNames(this.getDb(c, query.db));
  }

  async getTableSchema(c: Context<{ Bindings: Env }>, query: D1TableQuery) {
    const db = this.getDb(c, query.db);
    await this.findTable(db, query.table);
    return this.readColumns(db, query.table);
  }

  private async readColumns(db: D1Database, table: string) {
    const info = await db
      .prepare(`PRAGMA table_info(${this.quoteIdentifier(table)})`)
      .all<{ name: string; type: string; notnull: number; pk: number }>();
    return info.results.map((col) => ({
      name: col.name,
      type: col.type,
      notNull: col.notnull === 1,
      primaryKey: col.pk > 0,
      masked: MASKED_COLUMN_PATTERN.test(col.name),
    }));
  }

  async listRows(c: Context<{ Bindings: Env }>, query: ListD1RowsQuery) {
    const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(query.pageSize ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
    );
    const offset = (page - 1) * pageSize;
    if (offset > MAX_OFFSET) {
      throw new BadRequestError(
        `これ以上先のページは表示できません(先頭${MAX_OFFSET}行まで)。D1の読み取り行数節約のための制限です`,
      );
    }

    const db = this.getDb(c, query.db);
    const tableInfo = await this.findTable(db, query.table);

    // 件数(COUNT(*))は全行スキャンで読み取り行数を消費するため、ここでは取得せず
    // 「1行多く取得してhasMoreを判定」する。件数は別API(count)で明示的に取得する
    const rows = await db
      .prepare(`SELECT * FROM ${this.quoteIdentifier(query.table)} LIMIT ? OFFSET ?`)
      .bind(pageSize + 1, offset)
      .all<Record<string, unknown>>();

    const hasMore = rows.results.length > pageSize;
    const pageRows = rows.results.slice(0, pageSize);
    const columnDefs = await this.readColumns(db, query.table);
    const columns = pageRows.length > 0 ? Object.keys(pageRows[0]) : columnDefs.map((col) => col.name);
    const primaryKeys = columnDefs.filter((col) => col.primaryKey).map((col) => col.name);
    const writable =
      this.isDbWritable(query.db) &&
      tableInfo.type === "table" &&
      !WRITE_PROTECTED_TABLES.has(query.table) &&
      primaryKeys.length > 0;

    if (page === 1) {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "VIEW_D1_TABLE", RESOURCE_KEY, `${query.db}.${query.table}`, null, {
          db: query.db,
          table: query.table,
        }),
      );
    }

    return {
      columns,
      rows: pageRows.map((row) => this.sanitizeRow(row)),
      page,
      pageSize,
      hasMore,
      primaryKeys,
      writable,
    };
  }

  // 件数取得(全行スキャンのため、画面上の明示操作でのみ呼ぶ)
  async countRows(c: Context<{ Bindings: Env }>, query: D1TableQuery) {
    const db = this.getDb(c, query.db);
    await this.findTable(db, query.table);
    const row = await db
      .prepare(`SELECT COUNT(*) AS total FROM ${this.quoteIdentifier(query.table)}`)
      .first<{ total: number }>();
    return { total: Number(row?.total ?? 0) };
  }

  // 更新・削除の共通前処理: 書込可否・主キー指定の検証と、対象1行の取得(変更前の値)
  private async prepareRowWrite(c: Context<{ Bindings: Env }>, dbKey: string, table: string, key: RowKey) {
    if (!this.isDbWritable(dbKey)) {
      throw new BadRequestError("このデータベースは閲覧専用です(変更できません)");
    }
    if (WRITE_PROTECTED_TABLES.has(table)) {
      throw new BadRequestError("このテーブルは変更できません(マイグレーション管理テーブル)");
    }
    const db = this.getDb(c, dbKey);
    const tableInfo = await this.findTable(db, table);
    if (tableInfo.type === "view") throw new BadRequestError("ビューは変更できません");

    const columns = await this.readColumns(db, table);
    const primaryKeys = columns.filter((col) => col.primaryKey).map((col) => col.name);
    if (primaryKeys.length === 0) {
      throw new BadRequestError("主キーを持たないテーブルは変更できません");
    }
    const givenKeys = Object.keys(key);
    if (givenKeys.length !== primaryKeys.length || !primaryKeys.every((k) => givenKeys.includes(k))) {
      throw new BadRequestError(`主キー列(${primaryKeys.join(", ")})をすべて指定してください`);
    }

    const where = primaryKeys.map((k) => `${this.quoteIdentifier(k)} = ?`).join(" AND ");
    const binds = primaryKeys.map((k) => key[k]);
    const found = await db
      .prepare(`SELECT * FROM ${this.quoteIdentifier(table)} WHERE ${where} LIMIT 2`)
      .bind(...binds)
      .all<Record<string, unknown>>();
    if (found.results.length === 0) throw new NotFoundError("対象の行が見つかりません");
    if (found.results.length > 1) throw new BadRequestError("主キーで1行に特定できません");

    return { db, columns, primaryKeys, where, binds, before: found.results[0] };
  }

  // 編集画面用: 対象1行を取得(機密列のみ伏せ字、長文の切り詰めはしない)
  async getRow(c: Context<{ Bindings: Env }>, query: D1RowQuery) {
    let key: RowKey;
    try {
      key = JSON.parse(query.key);
    } catch {
      throw new BadRequestError("keyがJSONとして不正です");
    }
    const { before, columns } = await this.prepareRowWrite(c, query.db, query.table, key);
    return { row: this.sanitizeRow(before, false), columns };
  }

  async updateRow(c: Context<{ Bindings: Env }>, payload: UpdateD1RowPayload) {
    const { db, columns, primaryKeys, where, binds, before } = await this.prepareRowWrite(
      c,
      payload.db,
      payload.table,
      payload.key,
    );

    const setClauses: string[] = [];
    const setBinds: unknown[] = [];
    for (const [name, raw] of Object.entries(payload.values)) {
      const col = columns.find((cd) => cd.name === name);
      if (!col) throw new BadRequestError(`存在しない列です: ${name}`);
      if (primaryKeys.includes(name)) throw new BadRequestError(`主キー列は変更できません: ${name}`);
      if (col.masked) throw new BadRequestError(`この列は変更できません(機密列): ${name}`);
      setClauses.push(`${this.quoteIdentifier(name)} = ?`);
      setBinds.push(this.coerceValue(col, raw));
    }

    let result;
    try {
      result = await db
        .prepare(`UPDATE ${this.quoteIdentifier(payload.table)} SET ${setClauses.join(", ")} WHERE ${where}`)
        .bind(...setBinds, ...binds)
        .run();
    } catch (err) {
      throw new BadRequestError(`更新に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.auditWrite(c, "UPDATE_D1_ROW", payload, this.sanitizeRow(before), {
      values: this.sanitizeRow(payload.values as Record<string, unknown>),
    });
    return { success: true, changes: result.meta.changes ?? 0 };
  }

  async deleteRow(c: Context<{ Bindings: Env }>, payload: DeleteD1RowPayload) {
    if (payload.confirmTable !== payload.table) {
      throw new BadRequestError("確認用のテーブル名が一致しません");
    }
    const { db, where, binds, before } = await this.prepareRowWrite(c, payload.db, payload.table, payload.key);

    let result;
    try {
      result = await db
        .prepare(`DELETE FROM ${this.quoteIdentifier(payload.table)} WHERE ${where}`)
        .bind(...binds)
        .run();
    } catch (err) {
      // 他テーブルから参照されている場合(外部キー制約)等
      throw new BadRequestError(`削除に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.auditWrite(c, "DELETE_D1_ROW", payload, this.sanitizeRow(before), {});
    return { success: true, changes: result.meta.changes ?? 0 };
  }

  private auditWrite(
    c: Context<{ Bindings: Env }>,
    action: string,
    target: { db: string; table: string; key: RowKey },
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    c.executionCtx.waitUntil(
      logAuditEvent(c, action, RESOURCE_KEY, `${target.db}.${target.table}`, before, {
        db: target.db,
        table: target.table,
        key: target.key,
        ...after,
      }),
    );
  }

  // 数値型の列は文字列入力を数値へ変換する(空文字はNULL)。それ以外はそのまま
  private coerceValue(col: { name: string; type: string; notNull: boolean }, raw: string | number | boolean | null) {
    if (raw === null) {
      if (col.notNull) throw new BadRequestError(`NULLにできない列です: ${col.name}`);
      return null;
    }
    if (/INT|REAL|NUM|FLOAT|DOUBLE|BOOL/i.test(col.type)) {
      if (typeof raw === "boolean") return raw ? 1 : 0;
      if (raw === "") {
        if (col.notNull) throw new BadRequestError(`空にできない列です: ${col.name}`);
        return null;
      }
      const num = Number(raw);
      if (Number.isNaN(num)) throw new BadRequestError(`数値を入力してください: ${col.name}`);
      return num;
    }
    return typeof raw === "boolean" ? (raw ? 1 : 0) : raw;
  }

  private sanitizeRow(row: Record<string, unknown>, truncate = true): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) {
        result[key] = null;
      } else if (MASKED_COLUMN_PATTERN.test(key)) {
        result[key] = "***";
      } else if (Array.isArray(value) || value instanceof ArrayBuffer) {
        result[key] = "[BLOB]";
      } else if (truncate && typeof value === "string" && value.length > MAX_CELL_LENGTH) {
        result[key] = `${value.slice(0, MAX_CELL_LENGTH)}...(${value.length}文字、省略)`;
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
