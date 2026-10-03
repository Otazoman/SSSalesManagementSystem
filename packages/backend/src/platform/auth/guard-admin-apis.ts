import type { Context, Next } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { Env } from "../../types/env";
import { getSession } from "./get-session";

// BUG-020: 管理者だけが使えるAPIを、サーバー側で確かめる。
// 業務の操作(見積の削除など)の権限は画面で制御する方針(BUG-017)のため対象にせず、
// 権限そのものを変える操作・システムの設定・全データやログの参照だけを対象にする。

// 全ての操作(参照を含む)が管理者だけのAPI
const ADMIN_ONLY_PREFIXES = [
  "/api/approval-flows",
  "/api/audit-logs",
  "/api/d1-explorer",
  "/api/mail-logs",
  "/api/mail-settings",
  "/api/otp-logs",
  "/api/r2-explorer",
  "/api/roles",
];

// 参照(GET)は業務画面でも使うため誰でも可、変更は管理者だけのAPI
const ADMIN_ONLY_WRITE_PREFIXES = [
  "/api/announcements",
  "/api/company-settings",
  "/api/departments",
  "/api/permissions",
  "/api/progress/stage-owners",
  "/api/screen-descriptions",
  "/api/tax-categories",
  "/api/users",
];

// 上の対象のうち、管理者以外(ログイン前を含む)も使う変更の操作
const PUBLIC_WRITE_PATHS = new Set([
  "/api/users/setup-admin",
  "/api/users/forgot-password",
  "/api/users/reset-password-via-token",
  "/api/users/change-password",
]);

const matchesPrefix = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function isAdminOnlyApi(method: string, path: string): boolean {
  if (ADMIN_ONLY_PREFIXES.some((p) => matchesPrefix(path, p))) return true;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (PUBLIC_WRITE_PATHS.has(path)) return false;
  return ADMIN_ONLY_WRITE_PREFIXES.some((p) => matchesPrefix(path, p));
}

// 管理者かどうかは、cookieに書いたロールではなく、DBの現在のロールで判定する(ロールを外した直後から効く)
export async function isActiveAdmin(db: D1Database, userId: string): Promise<boolean> {
  const rows = await drizzle(db, { schema })
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.users, eq(schema.userRoles.userId, schema.users.id))
    .where(
      and(
        eq(schema.userRoles.userId, userId),
        eq(schema.userRoles.roleId, "admin"),
        eq(schema.users.isActive, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function adminGuard(c: Context<{ Bindings: Env }>, next: Next) {
  // Honoのc.req.pathは末尾の"/"を含みうるため、判定用に取り除く
  const path = c.req.path.length > 1 ? c.req.path.replace(/\/+$/, "") : c.req.path;
  if (!isAdminOnlyApi(c.req.method, path)) return next();

  const session = await getSession(c);
  if (!session) {
    return c.json({ success: false, message: "ログインが必要です" }, 401);
  }
  if (!(await isActiveAdmin(c.env.DB, session.userId))) {
    return c.json({ success: false, message: "この操作はシステム管理者だけが行えます" }, 403);
  }
  return next();
}
