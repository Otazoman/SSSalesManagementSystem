import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import type { Context } from "hono";
import { getSession } from "../../../platform/auth/get-session";

export type PartnerRecord = typeof schema.partners.$inferSelect;

export class ApprovalRepository {
  /**
   * partners.ts と全く同じ仕組みで操作ユーザーIDを特定
   * 署名付きセッションcookie、または users テーブルの先頭ユーザーを取得
   */
  static async getAuthenticatedOperatorId(
    c: Context,
    db: any,
  ): Promise<string> {
    const session = await getSession(c as any);
    if (session?.userId) {
      return session.userId;
    }
    const firstUser = await db.select().from(schema.users).limit(1);
    return firstUser[0]?.id ? String(firstUser[0].id) : "NO_USER_FOUND";
  }

  /**
   * 取引先（partners）レコードを1件取得
   */
  static async findPartnerById(
    db: any,
    id: string,
  ): Promise<PartnerRecord | null> {
    const result = await db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.id, id))
      .limit(1);
    return result[0] || null;
  }
}
