import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { JournalEventType, UpdateJournalPostingRuleInput } from "./journal-posting-rules.schema";
import type { PostingPattern } from "../../../platform/journal/posting-patterns";

export class JournalPostingRulesRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  // 設定済みの行のみを返す(eventType×4の未設定分を埋めるのはservice層の責務)
  async findAll() {
    return await this.db.select().from(schema.journalPostingRules);
  }

  async findByEventType(eventType: JournalEventType) {
    const res = await this.db
      .select()
      .from(schema.journalPostingRules)
      .where(eq(schema.journalPostingRules.eventType, eventType))
      .limit(1);
    return res[0] || null;
  }

  // eventTypeが固定4種でPKのため、行の新規作成はここでは行わずupsertのみを提供する
  // (存在しなければINSERT、存在すればUPDATE)
  async upsert(
    eventType: JournalEventType,
    input: UpdateJournalPostingRuleInput,
    opId: string,
    now: Date,
  ) {
    const values = {
      eventType,
      variableAccountPriority: input.variableAccountPriority,
      variableAccountFallbackCode: input.variableAccountFallbackCode || null,
      prepaidAccountCode: input.prepaidAccountCode || null,
      advanceReceivedAccountCode: input.advanceReceivedAccountCode || null,
      cashAccountCode: input.cashAccountCode || null,
      payableAccountCode: input.payableAccountCode || null,
      receivableAccountCode: input.receivableAccountCode || null,
      taxAccountCode: input.taxAccountCode || null,
      enabled: input.enabled,
      memo: input.memo || null,
      updatedBy: opId,
      updatedAt: now,
    };

    await this.db
      .insert(schema.journalPostingRules)
      .values(values)
      .onConflictDoUpdate({
        target: schema.journalPostingRules.eventType,
        set: {
          variableAccountPriority: values.variableAccountPriority,
          variableAccountFallbackCode: values.variableAccountFallbackCode,
          prepaidAccountCode: values.prepaidAccountCode,
          advanceReceivedAccountCode: values.advanceReceivedAccountCode,
          cashAccountCode: values.cashAccountCode,
          payableAccountCode: values.payableAccountCode,
          receivableAccountCode: values.receivableAccountCode,
          taxAccountCode: values.taxAccountCode,
          enabled: values.enabled,
          memo: values.memo,
          updatedBy: values.updatedBy,
          updatedAt: values.updatedAt,
        },
      });
  }

  // V-5: 保存済みの仕訳パターン(全事象分)
  async findAllPatterns() {
    return await this.db.select().from(schema.journalPostingPatterns);
  }

  async findPatternsByEventType(eventType: JournalEventType) {
    return await this.db
      .select()
      .from(schema.journalPostingPatterns)
      .where(eq(schema.journalPostingPatterns.eventType, eventType));
  }

  // 事象の全組をまとめて保存する(組ごとにINSERT、既にあればUPDATE)
  async upsertPatterns(eventType: JournalEventType, patterns: PostingPattern[], opId: string, now: Date) {
    if (patterns.length === 0) return;
    const statements = patterns.map((p) => {
      const values = {
        eventType,
        documentType: p.documentType,
        lineKind: p.lineKind,
        debitFromItem: p.debitFromItem,
        debitAccountCode: p.debitAccountCode || null,
        creditFromItem: p.creditFromItem,
        creditAccountCode: p.creditAccountCode || null,
        updatedBy: opId,
        updatedAt: now,
      };
      return this.db
        .insert(schema.journalPostingPatterns)
        .values(values)
        .onConflictDoUpdate({
          target: [
            schema.journalPostingPatterns.eventType,
            schema.journalPostingPatterns.documentType,
            schema.journalPostingPatterns.lineKind,
          ],
          set: {
            debitFromItem: values.debitFromItem,
            debitAccountCode: values.debitAccountCode,
            creditFromItem: values.creditFromItem,
            creditAccountCode: values.creditAccountCode,
            updatedBy: opId,
            updatedAt: now,
          },
        });
    });
    await this.db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  }

  // 更新時の科目コード検証用。存在確認だけでなく、廃止済み(suspended)科目を
  // うっかり指定しないよう、statusも合わせて返す
  async findAccountByCode(code: string) {
    const res = await this.db
      .select({ code: schema.accounts.code, status: schema.accounts.status })
      .from(schema.accounts)
      .where(eq(schema.accounts.code, code))
      .limit(1);
    return res[0] || null;
  }
}
