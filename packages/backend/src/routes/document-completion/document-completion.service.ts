import type { Context } from "hono";
import type { Env } from "../../types/env";
import { DocumentCompletionRepository } from "./document-completion.repository";
import type { ProgressStageKey } from "../progress/progress.schema";
import { logAuditEvent } from "../../platform/audit/log-audit-event";
import { NotFoundError } from "../../platform/http/http-error";

export type ForcedState = "COMPLETED" | "IN_PROGRESS";

// 伝票単位の「完了/進行中」の手動設定。各伝票の画面から操作し、進捗確認(閲覧専用)は結果を読んで反映する。
// 自動判定が実態と合わない場合(分納・複数計上など)の補正で、forcedState=nullで設定を解除して自動判定に戻す
export class DocumentCompletionService {
  private repo: DocumentCompletionRepository;

  constructor(repo: DocumentCompletionRepository) {
    this.repo = repo;
  }

  async get(stageKey: ProgressStageKey, documentId: string) {
    const row = await this.repo.find(stageKey, documentId);
    return { stageKey, documentId, forcedState: (row?.forcedState ?? null) as ForcedState | null };
  }

  async set(
    c: Context<{ Bindings: Env }>,
    stageKey: ProgressStageKey,
    documentId: string,
    forcedState: ForcedState | null,
  ) {
    if (!(await this.repo.documentExists(stageKey, documentId))) {
      throw new NotFoundError("対象の伝票が見つかりません");
    }
    const before = await this.repo.find(stageKey, documentId);
    if (forcedState === null) {
      await this.repo.remove(stageKey, documentId);
    } else {
      await this.repo.upsert(stageKey, documentId, forcedState, await this.repo.getOperatorEmployeeNumber(c));
    }
    c.executionCtx.waitUntil(
      logAuditEvent(
        c,
        "UPDATE_DOCUMENT_COMPLETION",
        "document_completion",
        `${stageKey}:${documentId}`,
        { forcedState: before?.forcedState ?? null },
        { forcedState },
      ),
    );
    return { success: true, stageKey, documentId, forcedState };
  }
}
