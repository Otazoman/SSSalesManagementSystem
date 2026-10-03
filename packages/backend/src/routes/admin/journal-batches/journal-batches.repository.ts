import { drizzle } from "drizzle-orm/d1";
import { eq, and, or, inArray, sql, asc, desc } from "drizzle-orm";
import { count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import * as journalSchema from "../../../db/journal-schema";
import { Env } from "../../../types/env";
import { SearchJournalBatchQuery } from "./journal-batches.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { startsWithText } from "../../../platform/repository/text-search";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { fetchInChunks } from "../../../platform/repository/chunked-fetch";

const JOURNAL_BATCHES_SORT_COLUMNS = {
  entryDate: journalSchema.journalBatches.entryDate,
  sourceType: journalSchema.journalBatches.sourceType,
  eventType: journalSchema.journalBatches.eventType,
  totalDebitAmount: journalSchema.journalBatches.totalDebitAmount,
  postedAt: journalSchema.journalBatches.postedAt,
};

// K-6: DB_JOURNAL(journal_batches/journal_lines)を読み取る、このコードベース初のリポジトリ。
// 既存のjournal-posting-events(main DB側のoutbox監視)とは別物。書き込み(反対仕訳+訂正仕訳の
// 生成)はplatform/journal/correct-journal-batch.tsが担当し、ここは読み取り専用にする
export class JournalBatchesRepository {
  private db; // main DB(勘定科目マスタ・操作者解決用)
  private journalDb; // DB_JOURNAL

  constructor(d1: D1Database, journalD1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.journalDb = drizzle(journalD1, { schema: journalSchema });
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(params: SearchJournalBatchQuery) {
    const conditions = [];
    if (params.sourceType)
      conditions.push(eq(journalSchema.journalBatches.sourceType, params.sourceType));
    if (params.eventType)
      conditions.push(eq(journalSchema.journalBatches.eventType, params.eventType));
    if (params.onlyOriginal === "true") {
      conditions.push(sql`${journalSchema.journalBatches.reversalOfBatchId} IS NULL`);
      conditions.push(sql`${journalSchema.journalBatches.correctionOfBatchId} IS NULL`);
    }
    if (params.startDate) {
      const startTimestamp = Math.floor(
        new Date(`${params.startDate}T00:00:00+09:00`).getTime() / 1000,
      );
      conditions.push(sql`${journalSchema.journalBatches.entryDate} >= ${startTimestamp}`);
    }
    if (params.endDate) {
      const end = new Date(`${params.endDate}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      const endTimestamp = Math.floor(end.getTime() / 1000);
      conditions.push(sql`${journalSchema.journalBatches.entryDate} < ${endTimestamp}`);
    }
    return conditions;
  }

  async findBatchesPage(params: SearchJournalBatchQuery, pagination: PaginationParams, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, JOURNAL_BATCHES_SORT_COLUMNS) ?? [
      desc(journalSchema.journalBatches.postedAt),
    ];
    const base = this.journalDb
      .select()
      .from(journalSchema.journalBatches)
      .where(combineConditions(this.buildConditions(params)));
    return await base.orderBy(...orderBy).limit(pagination.limit).offset(toOffset(pagination));
  }

  async countBatches(params: SearchJournalBatchQuery): Promise<number> {
    const result = await this.journalDb
      .select({ value: count() })
      .from(journalSchema.journalBatches)
      .where(combineConditions(this.buildConditions(params)));
    return result[0]?.value || 0;
  }

  async findBatchById(id: string) {
    const res = await this.journalDb
      .select()
      .from(journalSchema.journalBatches)
      .where(eq(journalSchema.journalBatches.id, id))
      .limit(1);
    return res[0] || null;
  }

  async findLinesByBatchId(batchId: string) {
    return await this.journalDb
      .select()
      .from(journalSchema.journalLines)
      .where(eq(journalSchema.journalLines.batchId, batchId))
      .orderBy(asc(journalSchema.journalLines.lineNo));
  }

  // 一覧(1ページ最大500件)でも使うため、D1のバインド変数上限に合わせて分けて引く。
  // 同じバッチの明細は同じ回に入るので、バッチ内はlineNo順のまま
  async findLinesByBatchIds(batchIds: string[]) {
    return await fetchInChunks(batchIds, (chunk) =>
      this.journalDb
        .select()
        .from(journalSchema.journalLines)
        .where(inArray(journalSchema.journalLines.batchId, chunk))
        .orderBy(asc(journalSchema.journalLines.lineNo)),
    );
  }

  // K-6-3: 連鎖表示用。sourceRefIdの接頭辞一致(元バッチのsourceRefIdそのもの、または
  // それに"#rev-"/"#cor-"サフィックスが付いたもの全て)でレコード一式を取得する。
  // 反対仕訳・訂正仕訳の生成方式(correct-journal-batch.ts)と対になる設計
  async findBatchesBySourceLineage(sourceType: string, baseSourceRefId: string) {
    return await this.journalDb
      .select()
      .from(journalSchema.journalBatches)
      .where(
        and(
          eq(journalSchema.journalBatches.sourceType, sourceType),
          or(
            eq(journalSchema.journalBatches.sourceRefId, baseSourceRefId),
            startsWithText(journalSchema.journalBatches.sourceRefId, `${baseSourceRefId}#`),
          ),
        ),
      )
      .orderBy(asc(journalSchema.journalBatches.postedAt));
  }

  // K-6-2: 訂正対象バッチが既に他の訂正操作で取消(反対仕訳化)済みでないかの検証用
  async findReversalOfBatch(targetBatchId: string) {
    const res = await this.journalDb
      .select({ id: journalSchema.journalBatches.id })
      .from(journalSchema.journalBatches)
      .where(eq(journalSchema.journalBatches.reversalOfBatchId, targetBatchId))
      .limit(1);
    return res[0] || null;
  }

  async findAccountsByCodes(codes: string[]) {
    if (codes.length === 0) return [];
    return await this.db
      .select({
        code: schema.accounts.code,
        name: schema.accounts.name,
        externalMappingCode: schema.accounts.externalMappingCode,
      })
      .from(schema.accounts)
      .where(inArray(schema.accounts.code, codes));
  }
}
