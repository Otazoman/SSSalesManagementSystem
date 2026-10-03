import { drizzle } from "drizzle-orm/d1";
import { eq, and, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import {
  CreatePartnerDeliveryDestinationInput,
  UpdatePartnerDeliveryDestinationInput,
  QueryInput,
} from "./partner-delivery-destinations.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";

// 新規要望(2026-09-23): 取引先ごとの複数納品先。warehouse-contacts.repository.tsと同型
// (メールで送る帳票の副問い合わせが無い分、より単純)
export class PartnerDeliveryDestinationsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(
    db: ReturnType<typeof drizzle<typeof schema>>,
  ): PartnerDeliveryDestinationsRepository {
    const repo: PartnerDeliveryDestinationsRepository = Object.create(
      PartnerDeliveryDestinationsRepository.prototype,
    );
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(query: QueryInput) {
    const conditions = [];
    if (query.partnerId) {
      conditions.push(eq(schema.partnerDeliveryDestinations.partnerId, query.partnerId));
    }
    if (query.status && query.status !== "all") {
      conditions.push(eq(schema.partnerDeliveryDestinations.status, query.status));
    }
    return conditions;
  }

  async findMany(query: QueryInput) {
    return await this.db
      .select()
      .from(schema.partnerDeliveryDestinations)
      .where(combineConditions(this.buildConditions(query)));
  }

  async countMany(query: QueryInput): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.partnerDeliveryDestinations)
      .where(combineConditions(this.buildConditions(query)));
    return result[0]?.value || 0;
  }

  // 受注の納品先プルダウン用(有効な納品先のみ)
  async findActiveByPartnerId(partnerId: string) {
    return await this.db
      .select()
      .from(schema.partnerDeliveryDestinations)
      .where(
        and(
          eq(schema.partnerDeliveryDestinations.partnerId, partnerId),
          eq(schema.partnerDeliveryDestinations.status, "active"),
        ),
      );
  }

  async findById(id: string) {
    const result = await this.db
      .select()
      .from(schema.partnerDeliveryDestinations)
      .where(eq(schema.partnerDeliveryDestinations.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findPartnerById(partnerId: string) {
    const result = await this.db
      .select({ id: schema.partners.id, name: schema.partners.name })
      .from(schema.partners)
      .where(eq(schema.partners.id, partnerId))
      .limit(1);
    return result[0] || null;
  }

  async create(
    id: string,
    data: CreatePartnerDeliveryDestinationInput,
    operatorId: string,
  ) {
    const now = new Date();
    await this.db.insert(schema.partnerDeliveryDestinations).values({
      id,
      ...data,
      status: "active",
      createdBy: operatorId,
      createdAt: now,
      updatedBy: operatorId,
      updatedAt: now,
    });
  }

  async update(
    id: string,
    data: UpdatePartnerDeliveryDestinationInput,
    operatorId: string,
  ) {
    await this.db
      .update(schema.partnerDeliveryDestinations)
      .set({
        ...data,
        updatedBy: operatorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.partnerDeliveryDestinations.id, id));
  }

  async updateStatus(id: string, status: string, operatorId: string, now: Date) {
    await this.db
      .update(schema.partnerDeliveryDestinations)
      .set({ status, updatedBy: operatorId, updatedAt: now })
      .where(eq(schema.partnerDeliveryDestinations.id, id));
  }

  async delete(id: string) {
    await this.db
      .delete(schema.partnerDeliveryDestinations)
      .where(eq(schema.partnerDeliveryDestinations.id, id));
  }
}
