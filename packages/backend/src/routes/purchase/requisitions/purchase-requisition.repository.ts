import { drizzle } from "drizzle-orm/d1";
import { sql, eq, and, asc, inArray, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { findTaxCategoryRates } from "../../../platform/repository/common-queries";
import { Env } from "../../../types/env";
import { SearchPurchaseRequisitionsQuery } from "./purchase-requisition.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";
import { BadRequestError } from "../../../platform/http/http-error";
import {
  buildPurchaseRequisitionItemInsertRow,
  PurchaseRequisitionItemInput,
} from "./purchase-requisition-item-mapper";

type PurchaseRequisitionItemRow = ReturnType<typeof buildPurchaseRequisitionItemInsertRow>;

// ヘッダクリックソート(追加要望D)の許可カラム
const PURCHASE_REQUISITIONS_SORT_COLUMNS = {
  id: schema.purchaseRequests.id,
  title: schema.purchaseRequests.title,
  status: schema.purchaseRequests.status,
  requestType: schema.purchaseRequests.requestType,
  totalAmount: schema.purchaseRequests.totalAmount,
  createdAt: schema.purchaseRequests.createdAt,
};

// quote.repository.tsと同じ方針。purchase_requests/purchase_request_items/purchase_request_attachmentsを扱う
export class PurchaseRequisitionRepository {
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
  ): PurchaseRequisitionRepository {
    const repo: PurchaseRequisitionRepository = Object.create(
      PurchaseRequisitionRepository.prototype,
    );
    repo.db = db;
    return repo;
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  // 税区分コード→税率のマップ取得(quote.repository.tsのfindTaxCategoryRates()と同じ用途、
  // Phase3フォローアップの消費税計算に使う)
  async findTaxCategoryRates(): Promise<Map<string, number>> {
    return findTaxCategoryRates(this.db);
  }

  private buildConditions(params: SearchPurchaseRequisitionsQuery) {
    const conditions = [];
    if (params.id)
      conditions.push(containsText(schema.purchaseRequests.id, params.id));
    if (params.title)
      conditions.push(
        containsText(schema.purchaseRequests.title, params.title),
      );
    if (params.status && params.status !== "all")
      conditions.push(eq(schema.purchaseRequests.status, params.status));
    if (params.requestType)
      conditions.push(
        eq(schema.purchaseRequests.requestType, params.requestType),
      );
    if (params.applicantId)
      conditions.push(
        eq(schema.purchaseRequests.applicantId, params.applicantId),
      );
    if (params.partnerId)
      conditions.push(eq(schema.purchaseRequests.partnerId, params.partnerId));
    // 追加要望: 明細に含まれる商品(コード・品目名。マスタ選択/手入力どちらも対象)で検索する
    if (params.itemKeyword) {
      const keyword = params.itemKeyword;
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${schema.purchaseRequestItems}
          LEFT JOIN ${schema.items} ON ${schema.items.id} = ${schema.purchaseRequestItems.itemId}
          WHERE ${schema.purchaseRequestItems.requestId} = ${schema.purchaseRequests.id}
            AND (
              ${containsText(schema.purchaseRequestItems.itemId, keyword)}
              OR ${containsText(schema.purchaseRequestItems.itemName, keyword)}
              OR ${containsText(schema.items.name, keyword)}
            )
        )`,
      );
    }

    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(
        sql`${schema.purchaseRequests.createdAt} >= ${startTimestamp}`,
      );
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(
        sql`${schema.purchaseRequests.createdAt} < ${endTimestamp}`,
      );
    }

    return conditions;
  }

  async findRequisitions(
    params: SearchPurchaseRequisitionsQuery,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, PURCHASE_REQUISITIONS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.purchaseRequests)
      .where(combineConditions(this.buildConditions(params)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findRequisitionsPage(
    params: SearchPurchaseRequisitionsQuery,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, PURCHASE_REQUISITIONS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.purchaseRequests)
      .where(combineConditions(this.buildConditions(params)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(pagination.limit).offset(toOffset(pagination));
  }

  async countRequisitions(
    params: SearchPurchaseRequisitionsQuery,
  ): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.purchaseRequests)
      .where(combineConditions(this.buildConditions(params)));
    return result[0]?.value || 0;
  }

  async findAttachmentsByRequisitionIds(requisitionIds: string[]) {
    if (requisitionIds.length === 0) return [];
    return await this.db
      .select()
      .from(schema.purchaseRequestAttachments)
      .where(
        inArray(schema.purchaseRequestAttachments.requestId, requisitionIds),
      );
  }

  // CSV用全件データ取得
  async findExportRequisitionsWithDetails() {
    return await this.db
      .select()
      .from(schema.purchaseRequests)
      .leftJoin(
        schema.purchaseRequestItems,
        eq(schema.purchaseRequests.id, schema.purchaseRequestItems.requestId),
      )
      .orderBy(asc(schema.purchaseRequests.id));
  }

  async existsRequisition(id: string) {
    const res = await this.db
      .select()
      .from(schema.purchaseRequests)
      .where(eq(schema.purchaseRequests.id, id))
      .limit(1);
    return res.length > 0;
  }

  async findRequisitionById(id: string) {
    const res = await this.db
      .select()
      .from(schema.purchaseRequests)
      .where(eq(schema.purchaseRequests.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findRequisitionItems(requisitionId: string) {
    return await this.db
      .select()
      .from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requisitionId));
  }

  async findRequisitionAttachments(requisitionId: string) {
    return await this.db
      .select()
      .from(schema.purchaseRequestAttachments)
      .where(eq(schema.purchaseRequestAttachments.requestId, requisitionId));
  }

  async insertRequisition(data: typeof schema.purchaseRequests.$inferInsert) {
    await this.db.insert(schema.purchaseRequests).values(data);
  }

  async updateRequisition(
    id: string,
    data: Partial<typeof schema.purchaseRequests.$inferInsert>,
  ) {
    await this.db
      .update(schema.purchaseRequests)
      .set(data)
      .where(eq(schema.purchaseRequests.id, id));
  }

  async deleteRequisition(id: string) {
    await this.db
      .delete(schema.purchaseRequests)
      .where(eq(schema.purchaseRequests.id, id));
  }

  async insertRequisitionItem(
    data: typeof schema.purchaseRequestItems.$inferInsert,
  ) {
    await this.db.insert(schema.purchaseRequestItems).values(data);
  }

  async deleteRequisitionItems(requisitionId: string) {
    await this.db
      .delete(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requisitionId));
  }

  // BUG-048: 承認済みの伝票の変更申請の承認時に、ヘッダーの更新・明細の入れ替え・履歴を1回の batch で書き込む
  // (以前は1つずつ書き込んでいたため、途中で失敗すると明細が消えたままになりえた)。itemRows が null なら明細は変えない
  // 2026-10-18(BUG-069): 保存内容の明細から明細行を組み立てる。この購買申請に既にある明細ID(item.id)を持つ明細は
  // そのIDを使い(=既存明細の更新)、それ以外は新しいIDで追加する(受注・発注と同じ方針)
  async buildSyncedItemRows(
    requisitionId: string,
    items: Array<PurchaseRequisitionItemInput & { id?: string | null }>,
  ): Promise<PurchaseRequisitionItemRow[]> {
    const existingIds = new Set((await this.findRequisitionItems(requisitionId)).map((row) => row.id));
    return items.map((item, index) => {
      const isKept = !!item.id && existingIds.has(item.id);
      return buildPurchaseRequisitionItemInsertRow({ ...item, lineId: isKept ? item.id : null }, requisitionId, index);
    });
  }

  // 削除しようとしている購買申請明細を参照している伝票の種類(参照が無ければ空配列)
  async findItemReferencesForRemoval(itemIds: string[]): Promise<string[]> {
    if (itemIds.length === 0) return [];
    const exists = async (table: any, column: any) =>
      (await this.db.select({ id: table.id }).from(table).where(inArray(column, itemIds)).limit(1)).length > 0;
    const checks: Array<[string, Promise<boolean>]> = [
      ["発注", exists(schema.orderItems, schema.orderItems.purchaseRequestItemId)],
      ["購買申請の添付", exists(schema.purchaseRequestAttachments, schema.purchaseRequestAttachments.purchaseRequestItemId)],
    ];
    const results = await Promise.all(checks.map(([, p]) => p));
    return checks.filter((_, i) => results[i]).map(([label]) => label);
  }

  // 2026-10-18(BUG-069): 明細IDを保ったまま、購買申請の明細を保存内容(rows)に合わせる書き込みを組み立てる(まだ実行しない)。
  // 以前は明細を全件削除して入れ直していたため、発注から参照されている購買申請を保存・変更申請の承認をすると
  // FK制約違反(500)になっていた。保存内容に無い明細は削除し、参照されている明細の削除は400で止める
  async buildItemSyncWrites(requisitionId: string, rows: PurchaseRequisitionItemRow[]): Promise<any[]> {
    const existingIds = (await this.findRequisitionItems(requisitionId)).map((row) => row.id);
    const keptIds = new Set(rows.map((row) => row.id).filter((id) => existingIds.includes(id)));
    const removedIds = existingIds.filter((id) => !keptIds.has(id));

    const referencedBy = await this.findItemReferencesForRemoval(removedIds);
    if (referencedBy.length > 0) {
      throw new BadRequestError(
        `${referencedBy.join("・")}から参照されている購買申請明細は削除できません(明細を残したまま数量などを変更してください)`,
      );
    }

    const writes: any[] = [];
    if (removedIds.length > 0) {
      writes.push(this.db.delete(schema.purchaseRequestItems).where(inArray(schema.purchaseRequestItems.id, removedIds)));
    }
    for (const row of rows) {
      if (keptIds.has(row.id)) {
        const { id: rowId, ...values } = row;
        writes.push(this.db.update(schema.purchaseRequestItems).set(values).where(eq(schema.purchaseRequestItems.id, rowId)));
      } else {
        writes.push(this.db.insert(schema.purchaseRequestItems).values(row));
      }
    }
    return writes;
  }

  async applyApprovedUpdate(
    requisitionId: string,
    header: Partial<typeof schema.purchaseRequests.$inferInsert>,
    itemRows: PurchaseRequisitionItemRow[] | null,
  ) {
    const statements: any[] = [
      this.db.update(schema.purchaseRequests).set(header).where(eq(schema.purchaseRequests.id, requisitionId)),
    ];
    if (itemRows) {
      // 2026-10-18(BUG-069): 明細IDを保ったまま更新する(発注とのつながりを保つ)
      statements.push(...(await this.buildItemSyncWrites(requisitionId, itemRows)));
    }
    await this.db.batch(statements as [any, ...any[]]);
  }

  async insertRequisitionAttachment(
    data: typeof schema.purchaseRequestAttachments.$inferInsert,
  ) {
    await this.db.insert(schema.purchaseRequestAttachments).values(data);
  }

  // 2026-10-18(BUG-068): 保存で既存の添付の行(ID・種類・登録者)を保ったまま更新・削除するため(platform/r2/sync-attachments.ts)
  async updateRequisitionAttachment(attachmentId: string, data: Partial<typeof schema.purchaseRequestAttachments.$inferInsert>) {
    await this.db.update(schema.purchaseRequestAttachments).set(data).where(eq(schema.purchaseRequestAttachments.id, attachmentId));
  }

  async deleteRequisitionAttachmentsByIds(attachmentIds: string[]) {
    if (attachmentIds.length === 0) return;
    await this.db.delete(schema.purchaseRequestAttachments).where(inArray(schema.purchaseRequestAttachments.id, attachmentIds));
  }

  async deleteRequisitionAttachments(requisitionId: string) {
    await this.db
      .delete(schema.purchaseRequestAttachments)
      .where(eq(schema.purchaseRequestAttachments.requestId, requisitionId));
  }

  async findAttachmentByIdAndRequisitionId(
    attachmentId: string,
    requisitionId: string,
  ) {
    const res = await this.db
      .select()
      .from(schema.purchaseRequestAttachments)
      .where(
        and(
          eq(schema.purchaseRequestAttachments.id, attachmentId),
          eq(schema.purchaseRequestAttachments.requestId, requisitionId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  /**
   * CSVインポート用: departmentSurrogateId列の値をsurrogateIdへ解決する。
   * 値がそのまま既存のsurrogateIdと一致すればそれを返し(後方互換)、
   * 一致しなければ部署コード(departments.id)とみなして解決する。
   * 同一コードで複数期間の部署が存在する場合は、現在有効な行を優先する。
   * 該当なしの場合はnullを返す。
   */
  async resolveDepartmentSurrogateId(
    codeOrSurrogateId: string,
  ): Promise<string | null> {
    const bySurrogate = await this.db
      .select({ surrogateId: schema.departments.surrogateId })
      .from(schema.departments)
      .where(eq(schema.departments.surrogateId, codeOrSurrogateId))
      .limit(1);
    if (bySurrogate[0]) return bySurrogate[0].surrogateId;

    const byCode = await this.db
      .select({
        surrogateId: schema.departments.surrogateId,
        validTo: schema.departments.validTo,
      })
      .from(schema.departments)
      .where(eq(schema.departments.id, codeOrSurrogateId));
    if (byCode.length === 0) return null;

    const now = new Date();
    const active = byCode.find(
      (d) => !d.validTo || new Date(d.validTo) >= now,
    );
    return (active ?? byCode[byCode.length - 1]).surrogateId;
  }

  // 購買申請ヘッダー Upsert (CSVインポート用)
  async upsertRequisitionFromCsv(
    data: typeof schema.purchaseRequests.$inferInsert,
  ) {
    await this.db
      .insert(schema.purchaseRequests)
      .values(data)
      .onConflictDoUpdate({
        target: schema.purchaseRequests.id,
        set: {
          title: data.title,
          departmentSurrogateId: data.departmentSurrogateId,
          applicantId: data.applicantId,
          inputPersonEmployeeNumber: data.inputPersonEmployeeNumber,
          requestType: data.requestType,
          status: data.status,
          partnerId: data.partnerId,
          partnerName: data.partnerName,
          partnerInputType: data.partnerInputType,
          projectId: data.projectId,
          totalAmount: data.totalAmount,
          taxAmount: data.taxAmount,
          memo: data.memo,
          updatedBy: data.updatedBy,
          updatedAt: data.updatedAt,
        },
      });
  }
}
