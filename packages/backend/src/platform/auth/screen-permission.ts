import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { Env } from "../../types/env";
import type { SessionPayload } from "./session-token";
import { AuthRepository } from "../../routes/auth/auth.repository";

// ロール1件分の権限ID(例: "sales_quotes:update")を、KV のキャッシュ優先で取得する。
// auth/profile(画面の権限の表示)と、サーバー側の画面の権限の確認(hasScreenPermission)で同じものを使う。
// 読めない時は空(以前の AuthService.fetchPermissionsForRole と同じ)
export async function fetchPermissionsForRole(env: Env, roleId: string): Promise<string[]> {
  try {
    const cached: string[] | null = await env.KV_PERMISSIONS.get(`role_permissions:${roleId}`, { type: "json" });
    if (cached !== null) return cached;

    const rows = await drizzle(env.DB, { schema })
      .select({ pId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId));
    const fetched = rows.map((r) => r.pId);
    await env.KV_PERMISSIONS.put(`role_permissions:${roleId}`, JSON.stringify(fetched), { expirationTtl: 86400 });
    return fetched;
  } catch (kvErr) {
    console.error("[Profile API KV Permissions Fetch Error]", kvErr);
    return [];
  }
}

/**
 * PERF-07 B-4: ログインユーザーが、画面(screens.ts の resource)に対して action(create・read・update・delete)の権限を持つか。
 * 画面の権限の表示(auth/profile と use-page-permission.ts)と同じく、付与された全ロールの権限を合わせて判断し、
 * 管理者(admin)は全て可。ただし管理者かどうかは cookie のロールではなく、DB の今のロールで判断する(adminGuard と同じ)。
 * ロールが1つも付与されていない時は、cookie のロール(管理者以外)の権限で判断する(auth/profile と同じ)
 */
export async function hasScreenPermission(
  env: Env,
  session: SessionPayload,
  resource: string,
  action: "create" | "read" | "update" | "delete",
): Promise<boolean> {
  const relations = await new AuthRepository(env.DB).fetchUserMatrixRelations(session.userId, new Date());
  const roleIds =
    relations.length > 0
      ? Array.from(new Set(relations.map((r) => r.roleId)))
      : [session.role && session.role !== "admin" ? session.role : "general_user"];
  if (relations.length > 0 && roleIds.includes("admin")) return true;

  const permissionsByRole = await Promise.all(roleIds.map((roleId) => fetchPermissionsForRole(env, roleId)));
  return permissionsByRole.some((permissions) => permissions.includes(`${resource}:${action}`));
}
