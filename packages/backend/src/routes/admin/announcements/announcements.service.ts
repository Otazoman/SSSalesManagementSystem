import { Context } from "hono";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Env } from "../../../types/env";
import { Announcement, AnnouncementPayload, MAX_ANNOUNCEMENTS } from "./announcements.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { plainTextToHtml, sanitizeHtml } from "../../../platform/html/sanitize-html";
import * as schema from "../../../db/schema";
import * as uiSchema from "../../../db/ui-schema";
import { todayJst } from "../../../platform/date/format-jst-date";

const RESOURCE_KEY = "admin_announcements";
// 移行元(従来の保存先: KV)。D1へ移した後は読み取りのみ(初回に1度だけD1へ取り込む)
const LEGACY_KV_KEY = "system_announcements";
const MIGRATED_MARKER_KEY = "system_announcements_migrated_to_d1";

// JST(UTC+9)の今日の日付(YYYY-MM-DD)
const todayInJst = todayJst;

type Row = typeof uiSchema.announcements.$inferSelect;

const toAnnouncement = (row: Row): Announcement => ({
  id: row.id,
  title: row.title,
  // 保存時にも無害化しているが、読み出し時にも念のため通す(サニタイズは冪等)
  body: sanitizeHtml(row.body),
  publishDate: row.publishDate,
  endDate: row.endDate,
  isImportant: row.isImportant,
  isPublished: row.isPublished,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedBy: row.updatedBy,
  updatedAt: row.updatedAt,
});

// ダッシュボードの「システムからのお知らせ」の管理。保存先は専用D1(DB_UI)。
// 従来のKV(結果整合)では、削除・更新が他拠点へ即時に反映されず「削除したのに残る」ことがあったため移行した
export class AnnouncementsService {
  private db(env: Env) {
    return drizzle(env.DB_UI, { schema: uiSchema });
  }

  /**
   * 従来のKVに保存されていたお知らせを、D1が空の場合に1度だけ取り込む(本文は平文→HTMLへ変換)。
   * 取り込み済みの印をKVに残すので、以後(全件を削除してD1が空になっても)再取り込みはしない。
   */
  private async migrateLegacyIfNeeded(env: Env) {
    const db = this.db(env);
    const existing = await db.select({ id: uiSchema.announcements.id }).from(uiSchema.announcements).limit(1);
    if (existing.length > 0) return;
    if (await env.COMPANY_SETTINGS.get(MIGRATED_MARKER_KEY)) return;

    const raw = await env.COMPANY_SETTINGS.get(LEGACY_KV_KEY);
    if (raw) {
      const legacy = JSON.parse(raw) as Array<Partial<Announcement> & { id: string }>;
      for (const a of legacy.slice(0, MAX_ANNOUNCEMENTS)) {
        await db.insert(uiSchema.announcements).values({
          id: a.id,
          title: a.title ?? "",
          body: plainTextToHtml(a.body ?? ""),
          publishDate: a.publishDate ?? todayInJst(),
          endDate: a.endDate ?? null,
          isImportant: !!a.isImportant,
          isPublished: a.isPublished !== false,
          createdBy: a.createdBy ?? "",
          createdAt: a.createdAt ?? new Date().toISOString(),
          updatedBy: a.updatedBy ?? "",
          updatedAt: a.updatedAt ?? new Date().toISOString(),
        });
      }
    }
    await env.COMPANY_SETTINGS.put(MIGRATED_MARKER_KEY, new Date().toISOString());
  }

  // 管理画面用: 公開・下書き・期限切れを含む全件(掲載日の新しい順)
  async listAll(env: Env) {
    await this.migrateLegacyIfNeeded(env);
    const rows = await this.db(env)
      .select()
      .from(uiSchema.announcements)
      .orderBy(desc(uiSchema.announcements.publishDate), desc(uiSchema.announcements.createdAt));
    return rows.map(toAnnouncement);
  }

  // ダッシュボード用: 公開中で、掲載日が今日以前、かつ掲載終了日を過ぎていないもの(重要なものを先頭、その中で新しい順)
  async listActive(env: Env) {
    await this.migrateLegacyIfNeeded(env);
    const today = todayInJst();
    const rows = await this.db(env)
      .select()
      .from(uiSchema.announcements)
      .where(
        and(
          eq(uiSchema.announcements.isPublished, true),
          lte(uiSchema.announcements.publishDate, today),
          or(isNull(uiSchema.announcements.endDate), gte(uiSchema.announcements.endDate, today)),
        ),
      )
      .orderBy(desc(uiSchema.announcements.publishDate), desc(uiSchema.announcements.createdAt));
    const list = rows.map(toAnnouncement);
    return list.sort((a, b) => Number(b.isImportant) - Number(a.isImportant));
  }

  // 入力中のHTMLを、実際に表示される形(無害化後)へ変換して返す(編集画面のプレビュー用。DBには保存しない)
  preview(body: string) {
    return { html: sanitizeHtml(body) };
  }

  private async operator(c: Context<{ Bindings: Env }>) {
    return resolveOperatorEmployeeNumber(c, drizzle(c.env.DB, { schema }));
  }

  async create(c: Context<{ Bindings: Env }>, payload: AnnouncementPayload) {
    await this.migrateLegacyIfNeeded(c.env);
    const db = this.db(c.env);
    const count = (await db.select({ id: uiSchema.announcements.id }).from(uiSchema.announcements)).length;
    if (count >= MAX_ANNOUNCEMENTS) {
      throw new BadRequestError(`お知らせは最大${MAX_ANNOUNCEMENTS}件までです。不要なものを削除してください`);
    }
    const operator = await this.operator(c);
    const now = new Date().toISOString();
    const row: Row = {
      id: crypto.randomUUID(),
      title: payload.title,
      body: sanitizeHtml(payload.body),
      publishDate: payload.publishDate,
      endDate: payload.endDate ?? null,
      isImportant: payload.isImportant,
      isPublished: payload.isPublished,
      createdBy: operator,
      createdAt: now,
      updatedBy: operator,
      updatedAt: now,
    };
    await db.insert(uiSchema.announcements).values(row);
    const created = toAnnouncement(row);
    c.executionCtx.waitUntil(logAuditEvent(c, "CREATE_ANNOUNCEMENT", RESOURCE_KEY, created.id, null, created));
    return created;
  }

  async update(c: Context<{ Bindings: Env }>, id: string, payload: AnnouncementPayload) {
    const db = this.db(c.env);
    const [before] = await db.select().from(uiSchema.announcements).where(eq(uiSchema.announcements.id, id));
    if (!before) throw new NotFoundError("お知らせが見つかりません");
    const patch = {
      title: payload.title,
      body: sanitizeHtml(payload.body),
      publishDate: payload.publishDate,
      endDate: payload.endDate ?? null,
      isImportant: payload.isImportant,
      isPublished: payload.isPublished,
      updatedBy: await this.operator(c),
      updatedAt: new Date().toISOString(),
    };
    await db.update(uiSchema.announcements).set(patch).where(eq(uiSchema.announcements.id, id));
    const updated = toAnnouncement({ ...before, ...patch });
    c.executionCtx.waitUntil(logAuditEvent(c, "UPDATE_ANNOUNCEMENT", RESOURCE_KEY, id, toAnnouncement(before), updated));
    return updated;
  }

  async remove(c: Context<{ Bindings: Env }>, id: string) {
    const db = this.db(c.env);
    const [target] = await db.select().from(uiSchema.announcements).where(eq(uiSchema.announcements.id, id));
    if (!target) throw new NotFoundError("お知らせが見つかりません");
    // D1は書き込み直後から全拠点で同じ内容を返すため、削除は次の一覧・ダッシュボードにすぐ反映される
    await db.delete(uiSchema.announcements).where(eq(uiSchema.announcements.id, id));
    c.executionCtx.waitUntil(logAuditEvent(c, "DELETE_ANNOUNCEMENT", RESOURCE_KEY, id, toAnnouncement(target), null));
    return { success: true };
  }
}
