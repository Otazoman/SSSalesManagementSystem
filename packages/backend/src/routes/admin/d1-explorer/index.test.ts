import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { d1ExplorerRouter } from "./index";

const db = drizzle(env.DB, { schema });
const now = new Date();

beforeEach(async () => {
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    passwordHash: "SECRET-HASH-VALUE",
    createdAt: now,
    updatedAt: now,
  });
});

async function call(path: string) {
  const ctx = createExecutionContext();
  const res = await d1ExplorerRouter.request(path, {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("D1参照(読み取り専用)", () => {
  it("閲覧可能なDBを返し、DB_OTPは含めない", async () => {
    const body = (await (await call("/databases")).json()) as { key: string }[];
    const keys = body.map((d) => d.key);
    expect(keys).toContain("main");
    expect(keys).not.toContain("otp");
  });

  it("テーブル一覧に内部テーブル(sqlite_*)は含まれない", async () => {
    const body = (await (await call("/tables?db=main")).json()) as { name: string }[];
    const names = body.map((t) => t.name);
    expect(names).toContain("users");
    expect(names.some((n) => n.startsWith("sqlite_"))).toBe(false);
  });

  it("列定義でパスワードハッシュ列がマスク対象と示される", async () => {
    const cols = (await (await call("/schema?db=main&table=users")).json()) as {
      name: string;
      masked: boolean;
    }[];
    expect(cols.find((c) => c.name === "password_hash")?.masked).toBe(true);
    expect(cols.find((c) => c.name === "email")?.masked).toBe(false);
  });

  it("行を取得でき、パスワードハッシュ列の値はマスクされる", async () => {
    const res = await call("/rows?db=main&table=users");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Record<string, unknown>[]; hasMore: boolean; columns: string[] };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].email).toBe("test@example.com");
    expect(body.rows[0].password_hash).toBe("***");
    expect(JSON.stringify(body)).not.toContain("SECRET-HASH-VALUE");
    expect(body.hasMore).toBe(false);
  });

  it("ページングはpageSize+1行の取得でhasMoreを判定する", async () => {
    await db.insert(schema.users).values({
      id: "user-002",
      employeeNumber: "EMP002",
      email: "test2@example.com",
      name: "二人目",
      createdAt: now,
      updatedAt: now,
    });
    const body = (await (await call("/rows?db=main&table=users&pageSize=1")).json()) as {
      rows: unknown[];
      hasMore: boolean;
    };
    expect(body.rows).toHaveLength(1);
    expect(body.hasMore).toBe(true);
  });

  it("件数は別APIで取得できる", async () => {
    const body = (await (await call("/count?db=main&table=users")).json()) as { total: number };
    expect(body.total).toBe(1);
  });

  it("存在しないテーブル名(SQLインジェクション試行を含む)は404", async () => {
    const res = await call(`/rows?db=main&table=${encodeURIComponent('users"; DROP TABLE users; --')}`);
    expect(res.status).toBe(404);
    const stillThere = (await (await call("/count?db=main&table=users")).json()) as { total: number };
    expect(stillThere.total).toBe(1);
  });

  it("不正なDB指定は400、深すぎるページは400", async () => {
    expect((await call("/tables?db=otp")).status).toBe(400);
    expect((await call("/rows?db=main&table=users&page=100000")).status).toBe(400);
  });
});

async function post(path: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await d1ExplorerRouter.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("D1編集(主キー指定の1行更新・削除)", () => {
  it("rowsの応答に主キー列と書込可否が含まれる", async () => {
    const body = (await (await call("/rows?db=main&table=users")).json()) as {
      primaryKeys: string[];
      writable: boolean;
    };
    expect(body.primaryKeys).toEqual(["id"]);
    expect(body.writable).toBe(true);
    const log = (await (await call("/rows?db=journal&table=journal_batches")).json()) as { writable: boolean };
    expect(log.writable).toBe(false);
  });

  it("1行を更新できる(数値列は文字列入力から変換)", async () => {
    const res = await post("/rows/update", {
      db: "main",
      table: "users",
      key: { id: "user-001" },
      values: { name: "更新後", is_active: "0" },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT name, is_active FROM users WHERE id = ?").bind("user-001").first<any>();
    expect(row.name).toBe("更新後");
    expect(row.is_active).toBe(0);
  });

  it("主キー列・機密列・存在しない列は更新できない", async () => {
    const base = { db: "main", table: "users", key: { id: "user-001" } };
    expect((await post("/rows/update", { ...base, values: { id: "x" } })).status).toBe(400);
    expect((await post("/rows/update", { ...base, values: { password_hash: "x" } })).status).toBe(400);
    expect((await post("/rows/update", { ...base, values: { nothing: "x" } })).status).toBe(400);
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind("user-001").first<any>();
    expect(row.password_hash).toBe("SECRET-HASH-VALUE");
  });

  it("NOT NULL列へのNULLは400、存在しない行は404、主キー不足は400", async () => {
    const base = { db: "main", table: "users" };
    expect((await post("/rows/update", { ...base, key: { id: "user-001" }, values: { name: null } })).status).toBe(400);
    expect((await post("/rows/update", { ...base, key: { id: "nope" }, values: { name: "x" } })).status).toBe(404);
    expect((await post("/rows/update", { ...base, key: {}, values: { name: "x" } })).status).toBe(400);
  });

  it("削除はテーブル名の再入力が必要で、1行だけ削除される", async () => {
    const mismatch = await post("/rows/delete", {
      db: "main",
      table: "users",
      key: { id: "user-001" },
      confirmTable: "wrong",
    });
    expect(mismatch.status).toBe(400);

    const ok = await post("/rows/delete", {
      db: "main",
      table: "users",
      key: { id: "user-001" },
      confirmTable: "users",
    });
    expect(ok.status).toBe(200);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<any>();
    expect(count.n).toBe(0);
  });

  it("閲覧専用DB(ログ・仕訳)とマイグレーション管理テーブルは変更できない", async () => {
    const journal = await post("/rows/delete", {
      db: "journal",
      table: "journal_batches",
      key: { id: "x" },
      confirmTable: "journal_batches",
    });
    expect(journal.status).toBe(400);
    const migrations = await post("/rows/update", {
      db: "main",
      table: "d1_migrations",
      key: { id: 1 },
      values: { name: "x" },
    });
    expect(migrations.status).toBe(400);
  });
});

describe("D1編集: 商談DB(2026-09-21 閲覧専用から編集・削除可へ変更)", () => {
  const nowSec = Math.floor(Date.now() / 1000);

  beforeEach(async () => {
    await env.DB_DEALS.prepare("DELETE FROM prospect_contacts").run();
    await env.DB_DEALS.prepare(
      "INSERT INTO prospect_contacts (id, partner_id, name, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind("pc-1", "P-1", "見込 太郎", "user-001", nowSec, "user-001", nowSec)
      .run();
  });

  it("商談DBは書込可能なDBとして返り、rowsの writable が true になる", async () => {
    const dbs = (await (await call("/databases")).json()) as { key: string; writable: boolean }[];
    expect(dbs.find((d) => d.key === "deals")?.writable).toBe(true);
    const rows = (await (await call("/rows?db=deals&table=prospect_contacts")).json()) as {
      writable: boolean;
      primaryKeys: string[];
    };
    expect(rows.primaryKeys).toEqual(["id"]);
    expect(rows.writable).toBe(true);
  });

  it("商談DBの1行を更新でき、変更が反映される", async () => {
    const res = await post("/rows/update", {
      db: "deals",
      table: "prospect_contacts",
      key: { id: "pc-1" },
      values: { name: "見込 次郎", memo: "更新メモ" },
    });
    expect(res.status).toBe(200);
    const row = await env.DB_DEALS.prepare("SELECT name, memo FROM prospect_contacts WHERE id = ?").bind("pc-1").first<any>();
    expect(row).toEqual({ name: "見込 次郎", memo: "更新メモ" });
  });

  it("商談DBの1行を、テーブル名の再入力つきで削除できる", async () => {
    const mismatch = await post("/rows/delete", {
      db: "deals",
      table: "prospect_contacts",
      key: { id: "pc-1" },
      confirmTable: "wrong",
    });
    expect(mismatch.status).toBe(400);
    const ok = await post("/rows/delete", {
      db: "deals",
      table: "prospect_contacts",
      key: { id: "pc-1" },
      confirmTable: "prospect_contacts",
    });
    expect(ok.status).toBe(200);
    const count = await env.DB_DEALS.prepare("SELECT COUNT(*) AS n FROM prospect_contacts").first<any>();
    expect(count.n).toBe(0);
  });

  it("商談DBでも、マイグレーション管理テーブルは変更できない", async () => {
    const res = await post("/rows/update", {
      db: "deals",
      table: "d1_migrations",
      key: { id: 1 },
      values: { name: "x" },
    });
    expect(res.status).toBe(400);
  });

  it("ログDB・仕訳DBは引き続き閲覧専用", async () => {
    const dbs = (await (await call("/databases")).json()) as { key: string; writable: boolean }[];
    expect(dbs.find((d) => d.key === "log")?.writable).toBe(false);
    expect(dbs.find((d) => d.key === "journal")?.writable).toBe(false);
  });
});
