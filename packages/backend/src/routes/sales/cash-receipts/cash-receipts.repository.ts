import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { SearchCashReceiptsQuery } from "./cash-receipts.schema";

// 追加要望L-1-a: 単体入金(cash_receipts)の永続化
export class CashReceiptsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  async findMany(params: SearchCashReceiptsQuery) {
    const conditions = [];
    if (params.partnerId) conditions.push(eq(schema.cashReceipts.partnerId, params.partnerId));
    if (params.status && params.status !== "all") {
      conditions.push(eq(schema.cashReceipts.status, params.status));
    }
    if (params.startDate) {
      conditions.push(gte(schema.cashReceipts.receiptDate, new Date(`${params.startDate}T00:00:00+09:00`)));
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      conditions.push(lt(schema.cashReceipts.receiptDate, end));
    }
    return this.db
      .select()
      .from(schema.cashReceipts)
      .where(combineConditions(conditions))
      .orderBy(desc(schema.cashReceipts.receiptDate), desc(schema.cashReceipts.id));
  }

  async findById(id: string) {
    const rows = await this.db.select().from(schema.cashReceipts).where(eq(schema.cashReceipts.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async existsId(id: string): Promise<boolean> {
    return (await this.findById(id)) !== null;
  }

  async partnerExists(partnerId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.partners.id })
      .from(schema.partners)
      .where(eq(schema.partners.id, partnerId))
      .limit(1);
    return rows.length > 0;
  }

  async insert(values: typeof schema.cashReceipts.$inferInsert) {
    await this.db.insert(schema.cashReceipts).values(values);
  }

  // 未紐づけの場合のみ紐づけ済みへ更新する(同時操作による二重紐づけ防止)。更新できた場合true
  async markLinked(id: string, billingHeaderId: string, operator: string): Promise<boolean> {
    const now = new Date();
    const result = await this.db
      .update(schema.cashReceipts)
      .set({ status: "LINKED", billingHeaderId, linkedAt: now, updatedBy: operator, updatedAt: now })
      .where(and(eq(schema.cashReceipts.id, id), eq(schema.cashReceipts.status, "UNLINKED")))
      .returning({ id: schema.cashReceipts.id });
    return result.length > 0;
  }

  async revertLinked(id: string, operator: string) {
    await this.db
      .update(schema.cashReceipts)
      .set({ status: "UNLINKED", billingHeaderId: null, linkedAt: null, updatedBy: operator, updatedAt: new Date() })
      .where(eq(schema.cashReceipts.id, id));
  }

  async delete(id: string) {
    await this.db.delete(schema.cashReceipts).where(eq(schema.cashReceipts.id, id));
  }
}
