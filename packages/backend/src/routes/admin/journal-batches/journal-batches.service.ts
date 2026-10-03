import { Context } from "hono";
import { JournalBatchesRepository } from "./journal-batches.repository";
import { correctJournalBatch } from "../../../platform/journal/correct-journal-batch";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { NotFoundError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { SearchJournalBatchQuery, CorrectJournalBatchPayload } from "./journal-batches.schema";
import { SortQuery } from "../../../platform/http/sort";
import { Env } from "../../../types/env";
import { pairJournalLines } from "../../../platform/journal/pair-journal-lines";

const RESOURCE_KEY = "accounting_journal_edit";

// K-6-3: 仕訳編集画面のバックエンド。書き込み(反対仕訳+訂正仕訳の生成)はcorrect-journal-batch.tsへ
// 委譲し、ここでは検索・詳細取得・連鎖表示・監査ログ記録のみを担当する
export class JournalBatchesService {
  private repo: JournalBatchesRepository;

  constructor(repo: JournalBatchesRepository) {
    this.repo = repo;
  }

  private classify(batch: { reversalOfBatchId: string | null; correctionOfBatchId: string | null }) {
    if (batch.reversalOfBatchId) return "REVERSAL" as const;
    if (batch.correctionOfBatchId) return "CORRECTION" as const;
    return "ORIGINAL" as const;
  }

  async searchBatchesPage(
    c: Context,
    query: SearchJournalBatchQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [result, total] = await Promise.all([
      this.repo.findBatchesPage(query, params, sort),
      this.repo.countBatches(query),
    ]);
    // V-5: 一覧でも「借方〇〇/貸方〇〇」の組を表示するため、ページ内のバッチの明細を組にして返す
    const lines = await this.repo.findLinesByBatchIds(result.map((b) => b.id));
    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_JOURNAL_BATCH_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
      }),
    );
    return buildListResponse(
      result.map((b) => ({
        ...b,
        type: this.classify(b),
        pairs: pairJournalLines(lines.filter((l) => l.batchId === b.id)),
      })),
      buildPaginationMeta(params, total),
    );
  }

  // K-6-3: バッチ詳細(明細込み)+同一系列の全バッチ(元バッチ→反対仕訳→訂正仕訳…の連鎖)を返す
  async getBatchDetail(id: string) {
    const batch = await this.repo.findBatchById(id);
    if (!batch) return null;

    const baseSourceRefId = batch.sourceRefId.split("#")[0];
    const chainBatches = await this.repo.findBatchesBySourceLineage(batch.sourceType, baseSourceRefId);
    const chainLines = await this.repo.findLinesByBatchIds(chainBatches.map((b) => b.id));

    const linesOf = (batchId: string) => chainLines.filter((l) => l.batchId === batchId);
    return {
      ...batch,
      type: this.classify(batch),
      lines: linesOf(batch.id),
      pairs: pairJournalLines(linesOf(batch.id)),
      chain: chainBatches.map((b) => ({
        ...b,
        type: this.classify(b),
        lines: linesOf(b.id),
        pairs: pairJournalLines(linesOf(b.id)),
      })),
    };
  }

  // K-6-1/K-6-2: 反対仕訳+訂正仕訳をセットで起票する
  async correctBatch(c: Context<{ Bindings: Env }>, id: string, body: CorrectJournalBatchPayload) {
    const target = await this.repo.findBatchById(id);
    if (!target) {
      throw new NotFoundError("対象の仕訳バッチが見つかりません");
    }

    const performedById = await this.repo.getFallbackOperatorId(c);
    const result = await correctJournalBatch({
      db: c.env.DB,
      dbJournal: c.env.DB_JOURNAL,
      targetBatchId: id,
      description: body.description,
      memo: body.memo,
      lines: body.lines,
      performedById,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CORRECT_JOURNAL_BATCH", RESOURCE_KEY, id, target, {
        targetBatchId: id,
        reversalBatchId: result.reversalBatchId,
        correctionBatchId: result.correctionBatchId,
      }),
    );

    return {
      success: true,
      message: "反対仕訳・訂正仕訳を起票しました",
      ...result,
    };
  }
}
