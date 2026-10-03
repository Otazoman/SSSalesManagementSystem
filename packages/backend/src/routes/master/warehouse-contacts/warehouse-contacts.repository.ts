import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, sql, getTableColumns } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { warehouseContactReceivesDocument } from "../../../platform/repository/contact-document-conditions";
import {
  WAREHOUSE_CONTACT_DOCUMENT_TYPES,
  normalizeDocumentTypes,
  type WarehouseContactDocumentType,
} from "../../../constants/contact-document-types";
import { Env } from "../../../types/env";
import {
  CreateWarehouseContactInput,
  UpdateWarehouseContactInput,
  QueryInput,
} from "./warehouse-contacts.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";

// 一覧の各行に、その担当者がメールで送る帳票(V-5)をカンマ区切りで付ける副問い合わせ
const documentTypesCsv = sql<string | null>`(SELECT group_concat(${schema.warehouseContactDocumentTypes.documentType}, ',') FROM ${schema.warehouseContactDocumentTypes} WHERE ${schema.warehouseContactDocumentTypes.contactId} = ${schema.warehouseContacts.id})`.as(
  "document_types_csv",
);

export class WarehouseContactsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): WarehouseContactsRepository {
    const repo: WarehouseContactsRepository = Object.create(WarehouseContactsRepository.prototype);
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(query: QueryInput) {
    const conditions = [];
    if (query.warehouseId) {
      conditions.push(eq(schema.warehouseContacts.warehouseId, query.warehouseId));
    }
    if (query.status && query.status !== "all") {
      conditions.push(eq(schema.warehouseContacts.status, query.status));
    }
    return conditions;
  }

  async findMany(query: QueryInput) {
    const rows = await this.db
      .select({ ...getTableColumns(schema.warehouseContacts), documentTypesCsv })
      .from(schema.warehouseContacts)
      .where(combineConditions(this.buildConditions(query)));
    return rows.map(({ documentTypesCsv: csv, ...rest }) => ({
      ...rest,
      documentTypes: normalizeDocumentTypes(WAREHOUSE_CONTACT_DOCUMENT_TYPES, csv ? csv.split(",") : []),
    }));
  }

  // V-5: 帳票のメール・OTP送信の宛先(有効で、その帳票を送る設定の担当者のみ)
  async findActiveContactsForDocument(warehouseId: string, documentType: WarehouseContactDocumentType) {
    return await this.db
      .select()
      .from(schema.warehouseContacts)
      .where(
        and(
          eq(schema.warehouseContacts.warehouseId, warehouseId),
          eq(schema.warehouseContacts.status, "active"),
          warehouseContactReceivesDocument(documentType),
        ),
      );
  }

  async findById(id: string) {
    const result = await this.db
      .select()
      .from(schema.warehouseContacts)
      .where(eq(schema.warehouseContacts.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findWarehouseById(warehouseId: string) {
    const result = await this.db
      .select({ status: schema.warehouses.status, name: schema.warehouses.name })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, warehouseId))
      .limit(1);
    return result[0] || null;
  }

  // documentTypes: メールで送る帳票(V-5)。呼び出し元が既定を解決済みの値を渡す
  async create(
    id: string,
    data: Omit<CreateWarehouseContactInput, "documentTypes">,
    documentTypes: readonly WarehouseContactDocumentType[],
    operatorId: string,
  ) {
    const now = new Date();
    await this.db.batch([
      this.db.insert(schema.warehouseContacts).values({
        id,
        ...data,
        status: "active",
        createdBy: operatorId,
        createdAt: now,
        updatedBy: operatorId,
        updatedAt: now,
      }),
      ...this.buildReplaceDocumentTypes(id, documentTypes),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  // メールで送る帳票を丸ごと置き換える(削除→追加)。空配列は「どの帳票も送らない」
  private buildReplaceDocumentTypes(contactId: string, documentTypes: readonly WarehouseContactDocumentType[]) {
    const types = normalizeDocumentTypes(WAREHOUSE_CONTACT_DOCUMENT_TYPES, documentTypes);
    return [
      this.db
        .delete(schema.warehouseContactDocumentTypes)
        .where(eq(schema.warehouseContactDocumentTypes.contactId, contactId)),
      ...(types.length > 0
        ? [
            this.db
              .insert(schema.warehouseContactDocumentTypes)
              .values(types.map((documentType) => ({ contactId, documentType }))),
          ]
        : []),
    ];
  }

  // data.documentTypesが未指定なら、メールで送る帳票(V-5)の設定は変えない
  async update(id: string, data: UpdateWarehouseContactInput, operatorId: string) {
    const { documentTypes, ...fields } = data;
    await this.db.batch([
      this.db
        .update(schema.warehouseContacts)
        .set({
          ...fields,
          updatedBy: operatorId,
          updatedAt: new Date(),
        })
        .where(eq(schema.warehouseContacts.id, id)),
      ...(documentTypes ? this.buildReplaceDocumentTypes(id, documentTypes) : []),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  async updateStatus(id: string, status: string, operatorId: string, now: Date) {
    await this.db
      .update(schema.warehouseContacts)
      .set({ status, updatedBy: operatorId, updatedAt: now })
      .where(eq(schema.warehouseContacts.id, id));
  }

  async delete(id: string) {
    await this.db.delete(schema.warehouseContacts).where(eq(schema.warehouseContacts.id, id));
  }

  async countMany(query: QueryInput): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.warehouseContacts)
      .where(combineConditions(this.buildConditions(query)));
    return result[0]?.value || 0;
  }
}
