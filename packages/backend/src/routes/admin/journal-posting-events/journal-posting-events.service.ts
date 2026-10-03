import { Context } from "hono";
import { JournalPostingEventsRepository } from "./journal-posting-events.repository";
import { retryJournalPosting } from "../../../platform/journal/post-journal-batch";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "accounting_journal";

export class JournalPostingEventsService {
  private repo: JournalPostingEventsRepository;

  constructor(d1: D1Database) {
    this.repo = new JournalPostingEventsRepository(d1);
  }

  async list(sort?: SortQuery) {
    return await this.repo.findRecent(sort);
  }

  // ユーザー確認済み方針: 転記の自動再試行(Cron等のバッチ)は行わない。
  // この操作(人が明示的に押す「再転記」ボタン)だけが、失敗した仕訳を再試行する唯一の経路
  async retry(c: Context<{ Bindings: Env }>, eventId: string) {
    const event = await this.repo.findById(eventId);
    if (!event) {
      throw new NotFoundError("対象の起票イベントが見つかりません");
    }
    if (event.status === "POSTED") {
      throw new BadRequestError("この起票イベントは既に転記済みです");
    }

    const result = await retryJournalPosting(c.env.DB, c.env.DB_JOURNAL, eventId);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RETRY_JOURNAL_POSTING", RESOURCE_KEY, eventId, event, {
        status: result.status,
        batchId: result.batchId,
      }),
    );

    if (result.status === "FAILED") {
      return {
        success: false,
        message: `再転記に失敗しました: ${result.errorMessage || "不明なエラー"}`,
      };
    }
    return { success: true, message: "再転記しました" };
  }
}
