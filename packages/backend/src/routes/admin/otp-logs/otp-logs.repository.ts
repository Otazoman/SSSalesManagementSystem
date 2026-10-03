import { drizzle } from "drizzle-orm/d1";
import { and, count, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import * as otpSchema from "../../../db/otp-schema";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム。未指定時は既存動作(発行日時降順)を維持する。
// partnerName/quoteTitleはページング後にJSで結合するため、整合性の取れるSQL実列のみに絞る
const OTP_LOGS_SORT_COLUMNS = {
  createdAt: otpSchema.otpChallenges.createdAt,
  email: otpSchema.otpChallenges.email,
  documentType: otpSchema.otpChallenges.documentType,
  attemptCount: otpSchema.otpChallenges.attemptCount,
  expiresAt: otpSchema.otpChallenges.expiresAt,
  verifiedAt: otpSchema.otpChallenges.verifiedAt,
};

export interface OtpLogSearchParams {
  parsedStart: number | null;
  parsedEnd: number | null;
  email?: string;
  partnerId?: string;
  subject?: string;
  // Item6 Phase6-4フォローアップ: 種別(documentType自体)・倉庫での絞り込みを追加
  documentType?: string;
  warehouseId?: string;
}

export interface OtpDownloadLogRecord {
  id: string;
  documentType: string;
  documentId: string;
  attachmentId: string;
  email: string;
  expiresAt: Date | null;
  attemptCount: number;
  verifiedAt: Date | null;
  createdAt: Date | null;
  quoteTitle: string | null;
  partnerName: string | null;
}

// Item6 Phase6-4: 出荷指示書・入荷指示書のOTPダウンロードもこのログ画面の対象に含める
// Item7残課題1: 注文請書(sales_order)がホワイトリストに含まれておらず一覧から除外されていた不具合を修正
// Item9 Phase5: 発注書(purchase_order)も同じ理由で追加
// 検収書発行フォローアップ: 検収書(acceptance_inspection)・納品書(delivery_note、実装時から
// 漏れていたものを今回あわせて修正)も同じ理由で追加
const TRACKED_DOCUMENT_TYPES = [
  "sales_quote",
  "shipment_instruction",
  "receipt_instruction",
  "sales_order",
  "purchase_order",
  "acceptance_inspection",
  "delivery_note",
];

// otp_challengesは機微情報のため専用DB(DB_OTP)に隔離されており、見積(quotes)・出荷指示・入荷指示・
// 取引先(partners)を持つメインDB(DB)とは物理的に別インスタンス(1つのSQLクエリでJOINできない)。
// そのため取引先名・件名での絞り込みは、先にメインDB側で対象のドキュメントID一覧を解決してから
// otp_challenges側をdocumentId INで絞り込む2段階方式を取る。
export class OtpLogsRepository {
  private otpDb;
  private mainDb;

  constructor(env: Env) {
    this.otpDb = drizzle(env.DB_OTP, { schema: otpSchema });
    this.mainDb = drizzle(env.DB, { schema });
  }

  // partnerId/subject/warehouseId絞り込みが不要な場合はnullを返す(=documentId制限なし)。
  // 件名(subject)は見積のtitleにしか存在しない概念のため、subject指定時は
  // 出荷指示・入荷指示は対象外(=一致なし)として扱う。倉庫(warehouseId)は逆に見積が
  // 持たない概念のため、warehouseId指定時は見積を対象外として扱う
  private async resolveMatchingDocumentIds(
    partnerId?: string,
    subject?: string,
    warehouseId?: string,
  ): Promise<string[] | null> {
    const cleanPartnerId = partnerId?.trim();
    const cleanSubject = subject?.trim();
    const cleanWarehouseId = warehouseId?.trim();
    if (!cleanPartnerId && !cleanSubject && !cleanWarehouseId) return null;

    const ids: string[] = [];

    if (!cleanWarehouseId) {
      const quoteConditions = [];
      if (cleanPartnerId) quoteConditions.push(eq(schema.quotes.partnerId, cleanPartnerId));
      if (cleanSubject) quoteConditions.push(containsText(schema.quotes.title, cleanSubject));
      const quoteRows = await this.mainDb
        .select({ id: schema.quotes.id })
        .from(schema.quotes)
        .where(and(...quoteConditions));
      ids.push(...quoteRows.map((r) => r.id));

      // Item7残課題1: 注文請書(sales_order)も見積と同じく倉庫概念を持たないため、同じ分岐で解決する
      const orderConditions = [];
      if (cleanPartnerId) orderConditions.push(eq(schema.salesOrders.partnerId, cleanPartnerId));
      if (cleanSubject) orderConditions.push(containsText(schema.salesOrders.title, cleanSubject));
      const orderRows = await this.mainDb
        .select({ id: schema.salesOrders.id })
        .from(schema.salesOrders)
        .where(and(...orderConditions));
      ids.push(...orderRows.map((r) => r.id));

      // Item9 Phase5: 発注書(purchase_order)も同じく倉庫概念を持たないため、同じ分岐で解決する
      const purchaseOrderConditions = [];
      if (cleanPartnerId) purchaseOrderConditions.push(eq(schema.orders.partnerId, cleanPartnerId));
      if (cleanSubject) purchaseOrderConditions.push(containsText(schema.orders.title, cleanSubject));
      const purchaseOrderRows = await this.mainDb
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(and(...purchaseOrderConditions));
      ids.push(...purchaseOrderRows.map((r) => r.id));
    }

    if (!cleanSubject && (cleanPartnerId || cleanWarehouseId)) {
      const shipmentConditions = [];
      if (cleanPartnerId) shipmentConditions.push(eq(schema.itemShipmentInstructions.partnerId, cleanPartnerId));
      if (cleanWarehouseId) shipmentConditions.push(eq(schema.itemShipmentInstructions.warehouseId, cleanWarehouseId));
      const shipmentRows = await this.mainDb
        .select({ id: schema.itemShipmentInstructions.id })
        .from(schema.itemShipmentInstructions)
        .where(and(...shipmentConditions));
      ids.push(...shipmentRows.map((r) => r.id));

      const receiptConditions = [];
      if (cleanPartnerId) receiptConditions.push(eq(schema.itemReceiptInstructions.partnerId, cleanPartnerId));
      if (cleanWarehouseId) receiptConditions.push(eq(schema.itemReceiptInstructions.warehouseId, cleanWarehouseId));
      const receiptRows = await this.mainDb
        .select({ id: schema.itemReceiptInstructions.id })
        .from(schema.itemReceiptInstructions)
        .where(and(...receiptConditions));
      ids.push(...receiptRows.map((r) => r.id));
    }

    // 検収書発行フォローアップ: 納品書(delivery_note)・検収書(acceptance_inspection)は件名・倉庫
    // どちらの概念も持たない(取引先のみ)ため、partnerId指定時のみ・件名/倉庫での絞り込みが
    // 一切無い場合に限って対象に含める(件名検索に「一致なし」ではなく「全件ヒット」してしまう
    // 誤り(空のAND条件)を避けるため、subject/warehouseId指定時はこれらの種別を対象外とする)
    if (!cleanSubject && !cleanWarehouseId && cleanPartnerId) {
      const deliveryNoteRows = await this.mainDb
        .select({ id: schema.itemShipmentHeaders.id })
        .from(schema.itemShipmentHeaders)
        .where(eq(schema.itemShipmentHeaders.partnerId, cleanPartnerId));
      ids.push(...deliveryNoteRows.map((r) => r.id));

      const acceptanceInspectionRows = await this.mainDb
        .select({ id: schema.itemReceiptHeaders.id })
        .from(schema.itemReceiptHeaders)
        .where(eq(schema.itemReceiptHeaders.partnerId, cleanPartnerId));
      ids.push(...acceptanceInspectionRows.map((r) => r.id));
    }

    return ids;
  }

  private buildConditions(
    params: OtpLogSearchParams,
    matchedDocumentIds: string[] | null,
  ): SQL[] {
    const conditions: SQL[] = [
      inArray(otpSchema.otpChallenges.documentType, TRACKED_DOCUMENT_TYPES),
    ];

    if (matchedDocumentIds !== null) {
      if (matchedDocumentIds.length === 0) {
        // 取引先名/件名に一致する見積が1件も無い場合は、確実にヒットしない条件で0件にする
        conditions.push(eq(otpSchema.otpChallenges.documentId, "__NO_MATCH__"));
      } else {
        conditions.push(
          inArray(otpSchema.otpChallenges.documentId, matchedDocumentIds),
        );
      }
    }

    if (params.email && params.email.trim() !== "") {
      conditions.push(
        containsText(otpSchema.otpChallenges.email, params.email.trim().toLowerCase()),
      );
    }

    if (params.documentType && params.documentType.trim() !== "") {
      conditions.push(eq(otpSchema.otpChallenges.documentType, params.documentType.trim()));
    }

    if (params.parsedStart !== null) {
      conditions.push(
        gte(otpSchema.otpChallenges.createdAt, new Date(params.parsedStart * 1000)),
      );
    }
    if (params.parsedEnd !== null) {
      conditions.push(
        lte(otpSchema.otpChallenges.createdAt, new Date(params.parsedEnd * 1000)),
      );
    }

    return conditions;
  }

  // documentId(quotes.id / itemShipmentInstructions.id / itemReceiptInstructions.id)から
  // 件名相当・取引先名を解決してマージする。出荷指示・入荷指示には「件名」の概念が無いため、
  // 文書種別のラベル("出荷指示書"/"入荷指示書")をquoteTitle欄に代用する
  private async attachDocumentInfo(
    rows: (typeof otpSchema.otpChallenges.$inferSelect)[],
  ): Promise<OtpDownloadLogRecord[]> {
    const documentIds = Array.from(new Set(rows.map((r) => r.documentId)));
    const quoteMap = new Map<
      string,
      { title: string | null; partnerName: string | null }
    >();
    const shipmentMap = new Map<string, { partnerName: string | null }>();
    const receiptMap = new Map<string, { partnerName: string | null }>();
    // Item7残課題1: 注文請書(sales_order)用
    const orderMap = new Map<
      string,
      { title: string | null; partnerName: string | null }
    >();
    // Item9 Phase5: 発注書(purchase_order)用
    const purchaseOrderMap = new Map<
      string,
      { title: string | null; partnerName: string | null }
    >();
    // 検収書発行フォローアップ: 納品書(delivery_note)・検収書(acceptance_inspection)用
    // (どちらも件名の概念が無いため、出荷指示・入荷指示と同じくpartnerNameのみ保持する)
    const deliveryNoteMap = new Map<string, { partnerName: string | null }>();
    const acceptanceInspectionMap = new Map<string, { partnerName: string | null }>();

    if (documentIds.length > 0) {
      const quoteRows = await this.mainDb
        .select({
          id: schema.quotes.id,
          title: schema.quotes.title,
          partnerName: schema.partners.name,
        })
        .from(schema.quotes)
        .leftJoin(schema.partners, eq(schema.quotes.partnerId, schema.partners.id))
        .where(inArray(schema.quotes.id, documentIds));
      for (const q of quoteRows) {
        quoteMap.set(q.id, { title: q.title, partnerName: q.partnerName ?? null });
      }

      const shipmentRows = await this.mainDb
        .select({
          id: schema.itemShipmentInstructions.id,
          partnerName: schema.partners.name,
        })
        .from(schema.itemShipmentInstructions)
        .leftJoin(
          schema.partners,
          eq(schema.itemShipmentInstructions.partnerId, schema.partners.id),
        )
        .where(inArray(schema.itemShipmentInstructions.id, documentIds));
      for (const s of shipmentRows) {
        shipmentMap.set(s.id, { partnerName: s.partnerName ?? null });
      }

      const receiptRows = await this.mainDb
        .select({
          id: schema.itemReceiptInstructions.id,
          partnerName: schema.partners.name,
        })
        .from(schema.itemReceiptInstructions)
        .leftJoin(
          schema.partners,
          eq(schema.itemReceiptInstructions.partnerId, schema.partners.id),
        )
        .where(inArray(schema.itemReceiptInstructions.id, documentIds));
      for (const r of receiptRows) {
        receiptMap.set(r.id, { partnerName: r.partnerName ?? null });
      }

      const orderRows = await this.mainDb
        .select({
          id: schema.salesOrders.id,
          title: schema.salesOrders.title,
          partnerName: schema.partners.name,
        })
        .from(schema.salesOrders)
        .leftJoin(schema.partners, eq(schema.salesOrders.partnerId, schema.partners.id))
        .where(inArray(schema.salesOrders.id, documentIds));
      for (const o of orderRows) {
        orderMap.set(o.id, { title: o.title, partnerName: o.partnerName ?? null });
      }

      const purchaseOrderRows = await this.mainDb
        .select({
          id: schema.orders.id,
          title: schema.orders.title,
          partnerName: schema.partners.name,
        })
        .from(schema.orders)
        .leftJoin(schema.partners, eq(schema.orders.partnerId, schema.partners.id))
        .where(inArray(schema.orders.id, documentIds));
      for (const po of purchaseOrderRows) {
        purchaseOrderMap.set(po.id, { title: po.title, partnerName: po.partnerName ?? null });
      }

      const deliveryNoteRows = await this.mainDb
        .select({
          id: schema.itemShipmentHeaders.id,
          partnerName: schema.partners.name,
        })
        .from(schema.itemShipmentHeaders)
        .leftJoin(schema.partners, eq(schema.itemShipmentHeaders.partnerId, schema.partners.id))
        .where(inArray(schema.itemShipmentHeaders.id, documentIds));
      for (const dn of deliveryNoteRows) {
        deliveryNoteMap.set(dn.id, { partnerName: dn.partnerName ?? null });
      }

      const acceptanceInspectionRows = await this.mainDb
        .select({
          id: schema.itemReceiptHeaders.id,
          partnerName: schema.partners.name,
        })
        .from(schema.itemReceiptHeaders)
        .leftJoin(schema.partners, eq(schema.itemReceiptHeaders.partnerId, schema.partners.id))
        .where(inArray(schema.itemReceiptHeaders.id, documentIds));
      for (const ai of acceptanceInspectionRows) {
        acceptanceInspectionMap.set(ai.id, { partnerName: ai.partnerName ?? null });
      }
    }

    return rows.map((r) => {
      if (r.documentType === "shipment_instruction") {
        const s = shipmentMap.get(r.documentId);
        return { ...r, quoteTitle: "出荷指示書", partnerName: s?.partnerName ?? null };
      }
      if (r.documentType === "receipt_instruction") {
        const rc = receiptMap.get(r.documentId);
        return { ...r, quoteTitle: "入荷指示書", partnerName: rc?.partnerName ?? null };
      }
      if (r.documentType === "sales_order") {
        const o = orderMap.get(r.documentId);
        return { ...r, quoteTitle: o?.title ?? "注文請書", partnerName: o?.partnerName ?? null };
      }
      if (r.documentType === "purchase_order") {
        const po = purchaseOrderMap.get(r.documentId);
        return { ...r, quoteTitle: po?.title ?? "発注書", partnerName: po?.partnerName ?? null };
      }
      if (r.documentType === "delivery_note") {
        const dn = deliveryNoteMap.get(r.documentId);
        return { ...r, quoteTitle: "納品書", partnerName: dn?.partnerName ?? null };
      }
      if (r.documentType === "acceptance_inspection") {
        const ai = acceptanceInspectionMap.get(r.documentId);
        return { ...r, quoteTitle: "検収書", partnerName: ai?.partnerName ?? null };
      }
      const q = quoteMap.get(r.documentId);
      return {
        ...r,
        quoteTitle: q?.title ?? null,
        partnerName: q?.partnerName ?? null,
      };
    });
  }

  async searchLogs(
    params: OtpLogSearchParams,
    sort: SortQuery = {},
  ): Promise<OtpDownloadLogRecord[]> {
    const matchedDocumentIds = await this.resolveMatchingDocumentIds(
      params.partnerId,
      params.subject,
      params.warehouseId,
    );
    const conditions = this.buildConditions(params, matchedDocumentIds);
    const orderBy =
      buildOrderBy(sort, OTP_LOGS_SORT_COLUMNS) ??
      [desc(otpSchema.otpChallenges.createdAt)];

    const rows = await this.otpDb
      .select()
      .from(otpSchema.otpChallenges)
      .where(combineConditions(conditions))
      .orderBy(...orderBy);

    return await this.attachDocumentInfo(rows);
  }

  async searchLogsPage(
    params: OtpLogSearchParams,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ): Promise<OtpDownloadLogRecord[]> {
    const matchedDocumentIds = await this.resolveMatchingDocumentIds(
      params.partnerId,
      params.subject,
      params.warehouseId,
    );
    const conditions = this.buildConditions(params, matchedDocumentIds);
    const orderBy =
      buildOrderBy(sort, OTP_LOGS_SORT_COLUMNS) ??
      [desc(otpSchema.otpChallenges.createdAt)];

    const rows = await this.otpDb
      .select()
      .from(otpSchema.otpChallenges)
      .where(combineConditions(conditions))
      .orderBy(...orderBy)
      .limit(pagination.limit)
      .offset(toOffset(pagination));

    return await this.attachDocumentInfo(rows);
  }

  async countLogs(params: OtpLogSearchParams): Promise<number> {
    const matchedDocumentIds = await this.resolveMatchingDocumentIds(
      params.partnerId,
      params.subject,
      params.warehouseId,
    );
    const conditions = this.buildConditions(params, matchedDocumentIds);

    const result = await this.otpDb
      .select({ value: count() })
      .from(otpSchema.otpChallenges)
      .where(combineConditions(conditions));
    return result[0]?.value || 0;
  }
}
