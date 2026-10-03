import { Context } from "hono";
import { JournalPostingRulesRepository } from "./journal-posting-rules.repository";
import {
  JOURNAL_EVENT_TYPES,
  JournalEventType,
  UpdateJournalPostingRuleInput,
} from "./journal-posting-rules.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { BadRequestError } from "../../../platform/http/http-error";
import {
  derivePatternFromRule,
  mergePatterns,
  slotLabel,
  slotsOf,
  type PostingPattern,
} from "../../../platform/journal/posting-patterns";
import * as schema from "../../../db/schema";

const RESOURCE_KEY = "accounting_journal_rules";

const EVENT_TYPE_LABEL: Record<JournalEventType, string> = {
  PREPAYMENT: "前払",
  PURCHASE: "仕入計上",
  ADVANCE_RECEIPT: "前受",
  SALES: "売上計上",
  RECEIPT: "入金",
  DISBURSEMENT: "支払",
};

type PostingRule = typeof schema.journalPostingRules.$inferSelect;

export class JournalPostingRulesService {
  private repo: JournalPostingRulesRepository;

  constructor(d1: D1Database) {
    this.repo = new JournalPostingRulesRepository(d1);
  }

  // eventTypeの全件(6件)を必ず返す。未設定分はenabled=false・科目すべてnullの既定値で埋める
  // (実在しない会社の勘定科目を推測で埋めることは絶対にしない)。
  // V-5: 各事象に、組ごとの借方・貸方の科目(patterns)を付けて返す
  async getAll() {
    const [existing, savedPatterns] = await Promise.all([this.repo.findAll(), this.repo.findAllPatterns()]);
    const byEventType = new Map(existing.map((row) => [row.eventType, row]));

    return JOURNAL_EVENT_TYPES.map((eventType) => {
      const row = byEventType.get(eventType);
      const patterns = mergePatterns(
        eventType,
        row ?? null,
        savedPatterns.filter((p) => p.eventType === eventType),
      );
      if (row) return { ...row, patterns };
      return {
        eventType,
        variableAccountPriority: "ITEM_MASTER_FIRST" as const,
        variableAccountFallbackCode: null,
        prepaidAccountCode: null,
        advanceReceivedAccountCode: null,
        cashAccountCode: null,
        payableAccountCode: null,
        receivableAccountCode: null,
        taxAccountCode: null,
        enabled: false,
        memo: null,
        updatedBy: null,
        updatedAt: null,
        patterns,
      };
    });
  }

  private async validateAccountCode(code: string | null | undefined, label: string) {
    if (!code) return;
    const account = await this.repo.findAccountByCode(code);
    if (!account) {
      throw new BadRequestError(`${label}に指定された勘定科目コード [${code}] は存在しません`);
    }
    if (account.status !== "active") {
      throw new BadRequestError(
        `${label}に指定された勘定科目 [${code}] は有効ではないため使用できません`,
      );
    }
  }

  // 保存する組。patterns で指定された組はその値、指定の無い組は役割別の科目(V-5より前の設定方法)から組み立てる
  private effectivePatterns(eventType: JournalEventType, input: UpdateJournalPostingRuleInput): PostingPattern[] {
    const legacyRule = { eventType, ...input } as unknown as PostingRule;
    return slotsOf(eventType).map((slot) => {
      const given = input.patterns?.find(
        (p) => p.documentType === slot.documentType && p.lineKind === slot.lineKind,
      );
      if (!given) return derivePatternFromRule(slot, legacyRule);
      return {
        documentType: slot.documentType,
        lineKind: slot.lineKind,
        debitFromItem: given.debitFromItem,
        debitAccountCode: given.debitAccountCode || null,
        creditFromItem: given.creditFromItem,
        creditAccountCode: given.creditAccountCode || null,
      };
    });
  }

  async update(
    c: Context<{ Bindings: Env }>,
    eventType: JournalEventType,
    input: UpdateJournalPostingRuleInput,
  ) {
    const unknown = input.patterns?.find(
      (p) => !slotsOf(eventType).some((s) => s.documentType === p.documentType && s.lineKind === p.lineKind),
    );
    if (unknown) {
      throw new BadRequestError(
        `${EVENT_TYPE_LABEL[eventType]}には、組[${unknown.documentType}・${unknown.lineKind}]はありません`,
      );
    }
    const patterns = this.effectivePatterns(eventType, input);

    // 有効化する場合のみ厳密に検証する。無効化(enabled=false)して途中保存する運用は妨げない
    if (input.enabled) {
      for (const p of patterns) {
        const label = `${EVENT_TYPE_LABEL[eventType]}の「${slotLabel(p)}」`;
        await this.validateAccountCode(p.debitAccountCode, `${label}の借方`);
        await this.validateAccountCode(p.creditAccountCode, `${label}の貸方`);
        // 前受・前渡の充当は、充当があるときだけ使うため任意(未設定のまま充当すると、仕訳の作成時にエラーにする)。
        // 品目の科目を使う側も、品目に科目が無い明細の受け皿として科目の設定を必須にする
        // (未設定の品目が1件でもあれば仕訳を作れなくなるため)
        if (p.lineKind !== "ADVANCE" && (!p.debitAccountCode || !p.creditAccountCode)) {
          const itemNote = p.debitFromItem || p.creditFromItem ? "(品目の科目を使う側は、品目に科目が無い場合の既定科目)" : "";
          throw new BadRequestError(
            `${label}を有効化するには、${label}の借方・貸方の両方の勘定科目が必要です${itemNote}`,
          );
        }
      }
    }

    const opId = await this.repo.getFallbackOperatorId(c);
    const oldRule = await this.repo.findByEventType(eventType);
    const oldPatterns = await this.repo.findPatternsByEventType(eventType);
    const now = new Date();
    await this.repo.upsert(eventType, input, opId, now);
    await this.repo.upsertPatterns(eventType, patterns, opId, now);

    c.executionCtx.waitUntil(
      logAuditEvent(
        c,
        "UPDATE_JOURNAL_POSTING_RULE",
        RESOURCE_KEY,
        eventType,
        oldRule ? { ...oldRule, patterns: oldPatterns } : null,
        { eventType, ...input, patterns },
      ),
    );

    return { success: true, message: `仕訳ルール(${eventType})を更新しました` };
  }
}
