import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import * as schema from "../../db/schema";
import type { Env } from "../../types/env";
import { resolveOperatorEmployeeNumber } from "../../platform/repository/fallback-operator";
import type { ProgressStageKey } from "../progress/progress.schema";

// 進捗確認の工程キー → その伝票の主テーブル(存在確認用)
const DOCUMENT_TABLES = {
  quote: schema.quotes,
  sales_order: schema.salesOrders,
  purchase_request: schema.purchaseRequests,
  purchase_order: schema.orders,
  receipt_instruction: schema.itemReceiptInstructions,
  item_receipt: schema.itemReceiptHeaders,
  purchase_recognition: schema.purchaseRecognitions,
  shipment_instruction: schema.itemShipmentInstructions,
  item_shipment: schema.itemShipmentHeaders,
  sales_invoice: schema.salesInvoices,
  billing: schema.billingHeaders,
  payment: schema.paymentHeaders,
} as const satisfies Record<ProgressStageKey, { id: unknown }>;

export class DocumentCompletionRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  getOperatorEmployeeNumber(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  async documentExists(stageKey: ProgressStageKey, documentId: string): Promise<boolean> {
    const table = DOCUMENT_TABLES[stageKey];
    const rows = await this.db.select({ id: table.id }).from(table).where(eq(table.id, documentId)).limit(1);
    return rows.length > 0;
  }

  async find(stageKey: string, documentId: string) {
    const t = schema.documentCompletionOverrides;
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.stageKey, stageKey), eq(t.documentId, documentId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(stageKey: string, documentId: string, forcedState: string, operator: string) {
    const t = schema.documentCompletionOverrides;
    const now = new Date();
    await this.db
      .insert(t)
      .values({
        id: crypto.randomUUID(),
        stageKey,
        documentId,
        forcedState,
        createdBy: operator,
        createdAt: now,
        updatedBy: operator,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [t.stageKey, t.documentId],
        set: { forcedState, updatedBy: operator, updatedAt: now },
      });
  }

  async remove(stageKey: string, documentId: string) {
    const t = schema.documentCompletionOverrides;
    await this.db.delete(t).where(and(eq(t.stageKey, stageKey), eq(t.documentId, documentId)));
  }
}
