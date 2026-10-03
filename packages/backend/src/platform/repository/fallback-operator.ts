import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../db/schema";
import { Env } from "../../types/env";
import { getSession } from "../auth/get-session";

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * 操作者(createdBy/updatedBy等)のフォールバックIDを取得する。
 * usersテーブルの先頭1件を暫定的な操作者として扱う(11機能のRepositoryで
 * ほぼ同一のまま重複実装されていたgetFallbackOperatorId()を共通化したもの)。
 * 該当ユーザーが1件も存在しない場合は`fallback`文字列を返す。
 *
 * Item1により、通常はセッションの実ユーザーを使う resolveOperatorEmployeeNumber() へ
 * 呼び出し元を順次移行する。この関数自体は「セッションが無い場合の最終フォールバック」として残す。
 */
export async function getFallbackOperatorId(
  db: AppDb,
  fallback: string = "NO_USER_FOUND",
): Promise<string> {
  const firstUser = await db.select().from(schema.users).limit(1);
  return firstUser[0]?.id ? String(firstUser[0].id) : fallback;
}

/**
 * Item1: createdBy/updatedBy等に記録する操作者のemployeeNumberを、セッションの実ユーザーから解決する。
 * DBへの問い合わせが不要になる(D1読み取り削減)ほか、記録される操作者が実際の操作者と一致するようになる。
 * セッションが無い場合(未ログイン文脈のバッチ処理等)のみ、従来のgetFallbackOperatorId()にフォールバックする。
 */
export async function resolveOperatorEmployeeNumber(
  c: Context<{ Bindings: Env }>,
  db: AppDb,
  fallback: string = "NO_USER_FOUND",
): Promise<string> {
  const session = await getSession(c);
  if (session?.employeeNumber) {
    return session.employeeNumber;
  }
  return getFallbackOperatorId(db, fallback);
}

/**
 * Item1: users.id値(承認ワークフローのapplicantId/approverId等、FK的に使われ続けるため
 * employeeNumber化の対象から除外したフィールド)を、他テーブルの純粋な監査用フィールド
 * (createdBy/updatedBy/uploadedById等)へ書き込む直前にemployeeNumberへ変換する。
 * 該当ユーザーが見つからない場合は元のuserIdをそのまま返す(安全側にフォールバック)。
 */
export async function resolveEmployeeNumberByUserId(
  db: AppDb,
  userId: string,
): Promise<string> {
  const result = await db
    .select({ employeeNumber: schema.users.employeeNumber })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return result[0]?.employeeNumber || userId;
}
