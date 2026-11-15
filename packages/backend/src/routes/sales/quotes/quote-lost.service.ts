import { Context } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { createDb } from "../../../platform/db/create-db";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import type { Env } from "../../../types/env";

const RESOURCE_KEY = "sales_quotes";

/**
 * REQ-015: 見積の失注。失注にできるのは承認済み(承認が OFF の時も、確定すると承認済みになる)で、受注に使われていない見積だけ。
 * 失注の見積は、編集・受注への変換・メール送信ができない(複写の元には使える)。取消すと承認済みに戻し、失注日・理由を空にする。承認は付けない。
 */
export const QUOTE_LOST_STATUS = "LOST";

async function loadQuote(c: Context<{ Bindings: Env }>, id: string) {
  const db = createDb(c.env.DB);
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id)).limit(1);
  if (!quote) throw new NotFoundError("対象の見積が見つかりません");
  return { db, quote };
}

export async function markQuoteLost(
  c: Context<{ Bindings: Env }>,
  id: string,
  input: { lostDate: string; lostReason?: string | null },
) {
  const { db, quote } = await loadQuote(c, id);
  if (quote.status !== "APPROVED") {
    throw new BadRequestError("失注にできるのは、承認済み(確定済み)の見積だけです");
  }
  const [order] = await db
    .select({ id: schema.salesOrders.id })
    .from(schema.salesOrders)
    .where(eq(schema.salesOrders.sourceQuoteId, id))
    .limit(1);
  if (order) {
    throw new BadRequestError(`受注(${order.id})に使われている見積は、失注にできません`);
  }

  const operatorId = await resolveOperatorEmployeeNumber(c, db);
  const lostReason = input.lostReason?.trim() || null;
  await db
    .update(schema.quotes)
    .set({ status: QUOTE_LOST_STATUS, lostDate: input.lostDate, lostReason, updatedBy: operatorId, updatedAt: new Date() })
    .where(eq(schema.quotes.id, id));

  c.executionCtx.waitUntil(
    logAuditEvent(c, "MARK_QUOTE_LOST", RESOURCE_KEY, id, quote, { status: QUOTE_LOST_STATUS, lostDate: input.lostDate, lostReason }),
  );
  return { success: true, message: "見積を失注にしました" };
}

export async function cancelQuoteLost(c: Context<{ Bindings: Env }>, id: string) {
  const { db, quote } = await loadQuote(c, id);
  if (quote.status !== QUOTE_LOST_STATUS) {
    throw new BadRequestError("失注の見積ではありません");
  }
  const operatorId = await resolveOperatorEmployeeNumber(c, db);
  await db
    .update(schema.quotes)
    .set({ status: "APPROVED", lostDate: null, lostReason: null, updatedBy: operatorId, updatedAt: new Date() })
    .where(eq(schema.quotes.id, id));

  c.executionCtx.waitUntil(logAuditEvent(c, "CANCEL_QUOTE_LOST", RESOURCE_KEY, id, quote, { status: "APPROVED" }));
  return { success: true, message: "見積の失注を取り消しました(承認済みに戻しました)" };
}

// 失注の見積を、編集・受注への変換に使わせない
export function assertQuoteNotLost(quote: { status: string } | null | undefined, action: string) {
  if (quote?.status === QUOTE_LOST_STATUS) {
    throw new BadRequestError(`失注の見積は${action}できません(先に失注を取り消してください)`);
  }
}
