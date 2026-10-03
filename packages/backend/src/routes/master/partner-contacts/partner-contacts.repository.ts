import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, sql, getTableColumns } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { partnerContactReceivesDocument } from "../../../platform/repository/contact-document-conditions";
import {
  PARTNER_CONTACT_DOCUMENT_TYPES,
  normalizeDocumentTypes,
  type PartnerContactDocumentType,
} from "../../../constants/contact-document-types";
import { Env } from "../../../types/env";
import {
  CreateContactInput,
  UpdateContactInput,
  QueryInput,
} from "./partner-contacts.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const PARTNER_CONTACTS_SORT_COLUMNS = {
  partnerId: schema.partnerContacts.partnerId,
  name: schema.partnerContacts.name,
  contactType: schema.partnerContacts.contactType,
  status: schema.partnerContacts.status,
};

// 一覧の各行に、その担当者がメールで送る帳票(V-5)をカンマ区切りで付ける副問い合わせ
const documentTypesCsv = sql<string | null>`(SELECT group_concat(${schema.partnerContactDocumentTypes.documentType}, ',') FROM ${schema.partnerContactDocumentTypes} WHERE ${schema.partnerContactDocumentTypes.contactId} = ${schema.partnerContacts.id})`.as(
  "document_types_csv",
);

function attachDocumentTypes<T extends { documentTypesCsv: string | null }>(row: T) {
  const { documentTypesCsv: csv, ...rest } = row;
  return {
    ...rest,
    documentTypes: normalizeDocumentTypes(PARTNER_CONTACT_DOCUMENT_TYPES, csv ? csv.split(",") : []),
  };
}

export class PartnerContactsRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  /**
   * 既にDrizzle化済みのdbインスタンスから構築する(workflow-engine/target-adapters等、
   * raw D1Databaseではなくワークフロー共通の既存db(AppDb)しか持たない文脈向け)。
   */
  static fromDb(
    db: ReturnType<typeof drizzle<typeof schema>>,
  ): PartnerContactsRepository {
    const repo: PartnerContactsRepository = Object.create(
      PartnerContactsRepository.prototype,
    );
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(query: QueryInput) {
    const conditions = [];
    if (query.partnerId && query.partnerId.trim() !== "") {
      conditions.push(eq(schema.partnerContacts.partnerId, query.partnerId));
    }
    if (query.name) {
      conditions.push(
        containsText(schema.partnerContacts.name, query.name.trim()),
      );
    }
    if (query.status && query.status !== "all") {
      conditions.push(eq(schema.partnerContacts.status, query.status));
    }
    return conditions;
  }

  async findMany(query: QueryInput, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, PARTNER_CONTACTS_SORT_COLUMNS);
    const base = this.db
      .select({ ...getTableColumns(schema.partnerContacts), documentTypesCsv })
      .from(schema.partnerContacts)
      .where(combineConditions(this.buildConditions(query)));
    return (await (orderBy ? base.orderBy(...orderBy) : base)).map(attachDocumentTypes);
  }

  async findManyPage(
    query: QueryInput,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, PARTNER_CONTACTS_SORT_COLUMNS);
    const base = this.db
      .select({ ...getTableColumns(schema.partnerContacts), documentTypesCsv })
      .from(schema.partnerContacts)
      .where(combineConditions(this.buildConditions(query)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return (await q.limit(params.limit).offset(toOffset(params))).map(attachDocumentTypes);
  }

  async countMany(query: QueryInput): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.partnerContacts)
      .where(combineConditions(this.buildConditions(query)));
    return result[0]?.value || 0;
  }

  // Item7残課題7/V-5: 帳票のメール・OTP送信の宛先(有効で、その帳票を送る設定の担当者のみ)。
  // warehouse-contacts.repository.tsのfindActiveContactsForDocumentと同じ方針
  async findActiveContactsForDocument(partnerId: string, documentType: PartnerContactDocumentType) {
    return await this.db
      .select()
      .from(schema.partnerContacts)
      .where(
        and(
          eq(schema.partnerContacts.partnerId, partnerId),
          eq(schema.partnerContacts.status, "active"),
          partnerContactReceivesDocument(documentType),
        ),
      );
  }

  async findById(id: string) {
    const result = await this.db
      .select()
      .from(schema.partnerContacts)
      .where(eq(schema.partnerContacts.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findPartnerById(partnerId: string) {
    const result = await this.db
      .select({ status: schema.partners.status, name: schema.partners.name })
      .from(schema.partners)
      .where(eq(schema.partners.id, partnerId))
      .limit(1);
    return result[0] || null;
  }

  async getAllPartnerStatusMap() {
    const partners = await this.db
      .select({
        id: schema.partners.id,
        status: schema.partners.status,
        name: schema.partners.name,
      })
      .from(schema.partners);

    const map = new Map<string, { status: string; name: string }>();
    partners.forEach((partner) =>
      map.set(partner.id, { status: partner.status, name: partner.name }),
    );
    return map;
  }

  // マスタコード自動採番: 呼び出し元(PartnerContactsService.create)がidを解決済みの前提のため、
  // ここではidをstring必須として受ける
  // documentTypes: メールで送る帳票(V-5)。呼び出し元が既定を解決済みの値を渡す
  async create(
    data: Omit<CreateContactInput, "documentTypes"> & { id: string },
    documentTypes: readonly PartnerContactDocumentType[],
    operatorId: string,
    status: string,
  ) {
    const now = new Date();
    await this.db.batch([
      this.db.insert(schema.partnerContacts).values({
        ...data,
        status,
        createdBy: operatorId,
        createdAt: now,
        updatedBy: operatorId,
        updatedAt: now,
      }),
      ...this.buildReplaceDocumentTypes(data.id, documentTypes),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  // メールで送る帳票を丸ごと置き換える(削除→追加)。空配列は「どの帳票も送らない」
  private buildReplaceDocumentTypes(contactId: string, documentTypes: readonly PartnerContactDocumentType[]) {
    const types = normalizeDocumentTypes(PARTNER_CONTACT_DOCUMENT_TYPES, documentTypes);
    return [
      this.db
        .delete(schema.partnerContactDocumentTypes)
        .where(eq(schema.partnerContactDocumentTypes.contactId, contactId)),
      ...(types.length > 0
        ? [
            this.db
              .insert(schema.partnerContactDocumentTypes)
              .values(types.map((documentType) => ({ contactId, documentType }))),
          ]
        : []),
    ];
  }

  // 既存の担当者IDの一覧(CSVインポートで、新規行にだけ帳票の既定を入れるために1回だけ取得する)
  async findAllIds(): Promise<Set<string>> {
    const rows = await this.db.select({ id: schema.partnerContacts.id }).from(schema.partnerContacts);
    return new Set(rows.map((r) => r.id));
  }

  async updateStatus(id: string, status: string, operatorId: string, now: Date) {
    await this.db
      .update(schema.partnerContacts)
      .set({ status, updatedBy: operatorId, updatedAt: now })
      .where(eq(schema.partnerContacts.id, id));
  }

  // data.documentTypesが未指定なら、メールで送る帳票(V-5)の設定は変えない
  async update(id: string, data: UpdateContactInput, operatorId: string) {
    const { documentTypes, ...fields } = data;
    await this.db.batch([
      this.db
        .update(schema.partnerContacts)
        .set({
          ...fields,
          updatedBy: operatorId,
          updatedAt: new Date(),
        })
        .where(eq(schema.partnerContacts.id, id)),
      ...(documentTypes ? this.buildReplaceDocumentTypes(id, documentTypes) : []),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  async delete(id: string) {
    await this.db
      .delete(schema.partnerContacts)
      .where(eq(schema.partnerContacts.id, id));
  }

  async upsertBulkItem(
    item: {
      id: string;
      partnerId: string;
      contactType: string;
      internalUserId: string | null;
      name: string | null;
      email: string | null;
      phone: string | null;
      fax: string | null;
      departmentName: string | null;
      isEmailTarget: boolean;
      memo: string | null;
      // 新規登録時の状態。既存の担当者の状態は変えない(onConflictDoUpdate の set に含めない)
      status: string;
    },
    operatorId: string,
    now: Date,
    // 未指定なら、メールで送る帳票(V-5)の設定は変えない(既存の担当者でCSVに帳票列が無い場合)
    documentTypes?: readonly PartnerContactDocumentType[],
  ) {
    const upsert = this.db
      .insert(schema.partnerContacts)
      .values({
        ...item,
        createdBy: operatorId,
        createdAt: now,
        updatedBy: operatorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.partnerContacts.id,
        set: {
          partnerId: item.partnerId,
          contactType: item.contactType,
          internalUserId: item.internalUserId,
          name: item.name,
          email: item.email,
          phone: item.phone,
          fax: item.fax,
          departmentName: item.departmentName,
          isEmailTarget: item.isEmailTarget,
          memo: item.memo,
          updatedBy: operatorId,
          updatedAt: now,
        },
      });
    await this.db.batch([
      upsert,
      ...(documentTypes ? this.buildReplaceDocumentTypes(item.id, documentTypes) : []),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
}
