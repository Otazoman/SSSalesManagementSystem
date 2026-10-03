import { drizzle } from "drizzle-orm/d1";
import { sql, eq, and, asc, inArray, desc, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { findActiveContactsByPartnerId, findMailTemplate, findTaxCategoryRates, findUnitNames, findUserByEmployeeNumber } from "../../../platform/repository/common-queries";
import { Env } from "../../../types/env";
import { SearchQuotesQuery } from "./quote.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { BadRequestError } from "../../../platform/http/http-error";
import { buildQuoteItemInsertRow, QuoteItemInput } from "./quote-item-mapper";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const QUOTES_SORT_COLUMNS = {
  id: schema.quotes.id,
  title: schema.quotes.title,
  partnerId: schema.quotes.partnerId,
  status: schema.quotes.status,
  quoteDate: schema.quotes.quoteDate,
  validUntil: schema.quotes.validUntil,
  totalAmount: schema.quotes.totalAmount,
  createdAt: schema.quotes.createdAt,
  salesPersonEmployeeNumber: schema.quotes.salesPersonEmployeeNumber,
  inputPersonEmployeeNumber: schema.quotes.inputPersonEmployeeNumber,
};

export class QuoteRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  /**
   * 既にDrizzle化済みのdbインスタンスから構築する(workflow-engine/target-adapters等、
   * raw D1Databaseではなくワークフロー共通の既存db(AppDb)しか持たない文脈向け)。
   */
  static fromDb(db: ReturnType<typeof drizzle<typeof schema>>): QuoteRepository {
    const repo: QuoteRepository = Object.create(QuoteRepository.prototype);
    repo.db = db;
    return repo;
  }

  // フォールバックオペレーター取得
  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  // 一覧検索
  private buildQuoteConditions(params: SearchQuotesQuery) {
    const conditions = [];
    if (params.id) conditions.push(containsText(schema.quotes.id, params.id));
    if (params.title)
      conditions.push(containsText(schema.quotes.title, params.title));
    // customerId -> partnerId
    if (params.partnerId)
      conditions.push(eq(schema.quotes.partnerId, params.partnerId));
    if (params.status && params.status !== "all")
      conditions.push(eq(schema.quotes.status, params.status));

    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(sql`${schema.quotes.createdAt} >= ${startTimestamp}`);
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(sql`${schema.quotes.createdAt} < ${endTimestamp}`);
    }

    if (params.salesPerson) {
      conditions.push(
        eq(schema.quotes.salesPersonEmployeeNumber, params.salesPerson),
      );
    }

    if (params.itemName) {
      const matchingQuotes = this.db
        .select({ quoteId: schema.quoteItems.quoteId })
        .from(schema.quoteItems)
        .where(containsText(schema.quoteItems.itemName, params.itemName));
      conditions.push(inArray(schema.quotes.id, matchingQuotes));
    }

    return conditions;
  }

  async findQuotes(params: SearchQuotesQuery, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, QUOTES_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.quotes)
      .where(combineConditions(this.buildQuoteConditions(params)));
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findQuotesPage(
    params: SearchQuotesQuery,
    pagination: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, QUOTES_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.quotes)
      .where(combineConditions(this.buildQuoteConditions(params)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(pagination.limit).offset(toOffset(pagination));
  }

  async countQuotes(params: SearchQuotesQuery): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.quotes)
      .where(combineConditions(this.buildQuoteConditions(params)));
    return result[0]?.value || 0;
  }

  // 複数の見積IDに対応する添付ファイル一覧取得
  async findAttachmentsByQuoteIds(quoteIds: string[]) {
    if (quoteIds.length === 0) return [];
    return await this.db
      .select()
      .from(schema.quoteAttachments)
      .where(inArray(schema.quoteAttachments.quoteId, quoteIds));
  }

  // CSV用全件データ取得
  // Item4-d: 自社担当者はquotes.salesPersonEmployeeNumberに直接employeeNumberで
  // 保存されているため(以前はupdatedByを兼用しUUIDが混入していた不具合の修正)、
  // usersテーブルへのJOINは不要
  async findExportQuotesWithDetails() {
    return await this.db
      .select()
      .from(schema.quotes)
      .leftJoin(
        schema.quoteItems,
        eq(schema.quotes.id, schema.quoteItems.quoteId),
      )
      .orderBy(asc(schema.quotes.id), asc(schema.quoteItems.sortOrder));
  }

  // 従業員番号でユーザー検索
  async findUserByEmployeeNumber(empNo: string) {
    return findUserByEmployeeNumber(this.db, empNo);
  }

  // 見積ヘッダー Upsert (CSVインポート用)
  async upsertQuoteFromCsv(data: any) {
    await this.db
      .insert(schema.quotes)
      .values(data)
      .onConflictDoUpdate({
        target: schema.quotes.id,
        set: {
          title: data.title,
          partnerId: data.partnerId, // customerId -> partnerId
          companyDepartment: data.companyDepartment,
          quoteDate: data.quoteDate,
          validUntil: data.validUntil,
          status: data.status,
          totalAmount: data.totalAmount,
          taxAmount: data.taxAmount,
          memo: data.memo,
          terms: data.terms,
          salesPersonEmployeeNumber: data.salesPersonEmployeeNumber,
          inputPersonEmployeeNumber: data.inputPersonEmployeeNumber,
          updatedBy: data.updatedBy,
          updatedAt: data.updatedAt,
        },
      });
  }

  // CSV取込の明細ID(lineId)の検証用: その明細IDを持つ見積のID(無ければnull)
  async findQuoteIdOfItem(quoteItemId: string): Promise<string | null> {
    const rows = await this.db
      .select({ quoteId: schema.quoteItems.quoteId })
      .from(schema.quoteItems)
      .where(eq(schema.quoteItems.id, quoteItemId))
      .limit(1);
    return rows[0]?.quoteId ?? null;
  }

  // CSV取込の再取込用: 見積明細が受注明細から参照されているか(参照されていれば明細を入れ替えない。
  // 入れ替えると受注との明細のつながりが消え、見積の受注済み数量が分からなくなるため。受注のCSV取込と同じ方針)
  async hasDownstreamItemReferences(quoteItemIds: string[]): Promise<boolean> {
    if (quoteItemIds.length === 0) return false;
    const rows = await this.db
      .select({ id: schema.salesOrderItems.id })
      .from(schema.salesOrderItems)
      .where(inArray(schema.salesOrderItems.sourceQuoteItemId, quoteItemIds))
      .limit(1);
    return rows.length > 0;
  }

  // 明細クリア
  // Item7残課題(2026-08-27、ユーザー報告): 見積から受注を作成すると
  // sales_order_items.sourceQuoteItemIdが本テーブルの行を参照するが、この参照にFK制約の
  // onDelete指定が無いため、受注作成済みの見積を編集(通常更新/CSV再インポート/承認確定)する
  // たびに毎回本メソッドの一括DELETEが「FOREIGN KEY constraint failed」で失敗する不具合があった。
  // この参照は表示用トレーサビリティのみ(消込判定には使わない設計、sales-order-item-mapper.ts等の
  // コメント参照)のため、削除前に参照側をNULLへ退避してから削除する(スキーマ変更を伴わない対応)
  async deleteQuoteItems(quoteId: string) {
    const targetItems = await this.db
      .select({ id: schema.quoteItems.id })
      .from(schema.quoteItems)
      .where(eq(schema.quoteItems.quoteId, quoteId));
    const targetIds = targetItems.map((row) => row.id);

    if (targetIds.length > 0) {
      await this.db
        .update(schema.salesOrderItems)
        .set({ sourceQuoteItemId: null })
        .where(inArray(schema.salesOrderItems.sourceQuoteItemId, targetIds));
    }

    await this.db
      .delete(schema.quoteItems)
      .where(eq(schema.quoteItems.quoteId, quoteId));
  }

  // 見積の明細を、明細IDを保ったまま保存内容に合わせる書き込みを組み立てる(まだ実行しない)。
  // 保存内容の明細のうち、この見積に既にある明細IDを持つものは更新、それ以外は新しい明細として追加し、
  // 保存内容に無い明細は削除する。受注明細から参照されている明細(sourceQuoteItemId)は削除させない(400)。
  // 以前は明細を全件入れ替え、受注明細からの参照をNULLへ退避していたが、見積の既受注数量(BUG-059)の計算に
  // 使うようになったため、明細IDとつながりを保つ方式に変えた
  async buildItemSyncWrites(quoteId: string, items: Array<QuoteItemInput & { id?: string | null }>) {
    const existingIds = new Set(
      (await this.db.select({ id: schema.quoteItems.id }).from(schema.quoteItems).where(eq(schema.quoteItems.quoteId, quoteId))).map(
        (row) => row.id,
      ),
    );
    const keptIds = new Set(items.map((item) => item.id).filter((id): id is string => !!id && existingIds.has(id)));
    const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

    if (removedIds.length > 0) {
      const referencing = await this.db
        .select({ salesOrderId: schema.salesOrderItems.salesOrderId })
        .from(schema.salesOrderItems)
        .where(inArray(schema.salesOrderItems.sourceQuoteItemId, removedIds));
      if (referencing.length > 0) {
        const orderIds = [...new Set(referencing.map((row) => row.salesOrderId))].join(", ");
        throw new BadRequestError(
          `受注[${orderIds}]から参照されている見積明細は削除できません(明細を残したまま数量などを変更してください)`,
        );
      }
    }

    const writes: any[] = [];
    if (removedIds.length > 0) {
      writes.push(this.db.delete(schema.quoteItems).where(inArray(schema.quoteItems.id, removedIds)));
    }
    items.forEach((item, index) => {
      const isKept = !!item.id && keptIds.has(item.id);
      const row = buildQuoteItemInsertRow({ ...item, lineId: isKept ? item.id : null }, quoteId, index);
      if (isKept) {
        const { id: rowId, ...values } = row;
        writes.push(this.db.update(schema.quoteItems).set(values).where(eq(schema.quoteItems.id, rowId)));
      } else {
        writes.push(this.db.insert(schema.quoteItems).values(row));
      }
    });
    return writes;
  }

  // BUG-048: 承認済みの伝票の変更申請の承認時に、ヘッダーの更新・明細の更新・履歴を1回の batch で書き込む
  // (以前は1つずつ書き込んでいたため、途中で失敗すると明細が消えたままになりえた)。items が null なら明細は変えない。
  // 明細は buildItemSyncWrites で明細IDを保ったまま更新する(受注明細とのつながりを保つ)
  async applyApprovedUpdate(
    quoteId: string,
    header: Partial<typeof schema.quotes.$inferInsert>,
    items: Array<QuoteItemInput & { id?: string | null }> | null,
    history: typeof schema.quoteHistoryLogs.$inferInsert,
  ) {
    const statements: any[] = [this.db.update(schema.quotes).set(header).where(eq(schema.quotes.id, quoteId))];
    if (items) {
      statements.push(...(await this.buildItemSyncWrites(quoteId, items)));
    }
    statements.push(this.db.insert(schema.quoteHistoryLogs).values(history));
    await this.db.batch(statements as [any, ...any[]]);
  }

  // 明細単一追加
  async insertQuoteItem(itemData: any) {
    await this.db.insert(schema.quoteItems).values(itemData);
  }

  // 見積単一取得
  async findQuoteById(id: string) {
    const res = await this.db
      .select()
      .from(schema.quotes)
      .where(eq(schema.quotes.id, id))
      .limit(1);
    return res[0] || null;
  }

  // 単一見積の明細一覧
  async findQuoteItems(quoteId: string) {
    return await this.db
      .select()
      .from(schema.quoteItems)
      .where(eq(schema.quoteItems.quoteId, quoteId))
      .orderBy(asc(schema.quoteItems.sortOrder));
  }

  // 単一見積の添付一覧
  async findQuoteAttachments(quoteId: string) {
    return await this.db
      .select()
      .from(schema.quoteAttachments)
      .where(eq(schema.quoteAttachments.quoteId, quoteId));
  }

  // ID重複チェック
  async existsQuote(id: string) {
    const res = await this.db
      .select()
      .from(schema.quotes)
      .where(eq(schema.quotes.id, id))
      .limit(1);
    return res.length > 0;
  }

  // 見積ヘッダー新規作成
  async insertQuote(data: any) {
    await this.db.insert(schema.quotes).values(data);
  }

  // 添付ファイルインサート
  async insertQuoteAttachment(data: any) {
    await this.db.insert(schema.quoteAttachments).values(data);
  }

  // 見積ヘッダー更新
  async updateQuote(id: string, data: any) {
    await this.db
      .update(schema.quotes)
      .set(data)
      .where(eq(schema.quotes.id, id));
  }

  // 添付ファイルの物理削除用クリア
  async deleteQuoteAttachments(quoteId: string) {
    await this.db
      .delete(schema.quoteAttachments)
      .where(eq(schema.quoteAttachments.quoteId, quoteId));
  }

  // 履歴ログ追加
  async insertHistoryLog(data: any) {
    await this.db.insert(schema.quoteHistoryLogs).values(data);
  }

  // 見積削除
  async deleteQuote(id: string) {
    await this.db.delete(schema.quotes).where(eq(schema.quotes.id, id));
  }

  // PDF生成用 取引先および担当ユーザー結合取得
  async findQuoteWithPartner(id: string) {
    return await this.db
      .select({
        quotes: schema.quotes,
        partners: schema.partners,
        users: schema.users,
        departmentName: schema.departments.name, // 👈 部署名を抽出するフィールドを追加
      })
      .from(schema.quotes)
      .leftJoin(
        schema.partners,
        eq(schema.quotes.partnerId, schema.partners.id),
      )
      // Item4-d: 自社担当者はsalesPersonEmployeeNumber(employeeNumber)で保持
      .leftJoin(
        schema.users,
        eq(schema.quotes.salesPersonEmployeeNumber, schema.users.employeeNumber),
      )
      .leftJoin(
        schema.userRoles, // 👈 中間テーブルをJOIN
        eq(schema.users.id, schema.userRoles.userId),
      )
      .leftJoin(
        schema.departments, // 👈 部署マスタテーブルをJOIN
        eq(
          schema.userRoles.departmentSurrogateId,
          schema.departments.surrogateId,
        ),
      )
      .where(eq(schema.quotes.id, id))
      .limit(1);
  }

  // ユーザー単一取得
  async findUserById(id: string) {
    const res = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return res[0] || null;
  }

  // 単一添付ファイルレコード取得
  async findAttachmentByIdAndQuoteId(attachmentId: string, quoteId: string) {
    const res = await this.db
      .select()
      .from(schema.quoteAttachments)
      .where(
        and(
          eq(schema.quoteAttachments.id, attachmentId),
          eq(schema.quoteAttachments.quoteId, quoteId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  // 税区分コード→税率のマップ取得(Item4-a: 帳票テンプレートの税率別内訳表算出用)
  async findTaxCategoryRates(): Promise<Map<string, number>> {
    return findTaxCategoryRates(this.db);
  }

  // 単位コード→単位名(日本語)のマップ取得(Item4-a: 帳票テンプレートの{{item.unit}}表示用。
  // quoteItems.unitCodeはコードのみ保持しているため、表示名は都度マスタから引く)
  async findUnitNames(): Promise<Map<string, string>> {
    return findUnitNames(this.db);
  }

  // メールテンプレート取得
  async findMailTemplate(id: string) {
    return findMailTemplate(this.db, id);
  }

  // 承認済み見積取得
  async findApprovedQuotesByIds(quoteIds: string[]) {
    return await this.db
      .select()
      .from(schema.quotes)
      .where(
        and(
          inArray(schema.quotes.id, quoteIds),
          eq(schema.quotes.status, "APPROVED"),
        ),
      );
  }

  // 紐づく最新PDF添付ファイルを取得
  async findLatestPdfAttachment(quoteId: string) {
    const res = await this.db
      .select()
      .from(schema.quoteAttachments)
      .where(
        and(
          eq(schema.quoteAttachments.quoteId, quoteId),
          eq(schema.quoteAttachments.fileType, "PDF"),
        ),
      )
      .orderBy(desc(schema.quoteAttachments.uploadedAt))
      .limit(1);
    return res[0] || null;
  }

  // 取引先担当者（メール通知対象）取得
  async findActiveContactsByPartnerId(partnerId: string) {
    return findActiveContactsByPartnerId(this.db, partnerId, "quote");
  }
}
