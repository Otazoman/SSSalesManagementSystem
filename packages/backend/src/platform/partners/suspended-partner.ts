import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { BadRequestError } from "../http/http-error";

// BUG-066: 取引停止(suspended)の取引先を指定した伝票の新規登録を拒否する(画面の選択肢から外すだけでなく、APIでも止める)。
// 既存伝票の更新・CSV取込は対象外(取引停止前に作った伝票の修正や、過去データの取込を止めないため)。
// 取引先が見つからない・未指定の場合は、各伝票の既存の検証に任せる
export async function assertPartnerNotSuspended(d1: D1Database, partnerId: string | null | undefined) {
  if (!partnerId) return;
  const [partner] = await drizzle(d1, { schema })
    .select({ name: schema.partners.name, status: schema.partners.status })
    .from(schema.partners)
    .where(eq(schema.partners.id, partnerId))
    .limit(1);
  if (partner?.status === "suspended") {
    throw new BadRequestError(
      `取引先「${partner.name}」[${partnerId}]は取引停止中のため、新しく伝票を登録できません`,
    );
  }
}
