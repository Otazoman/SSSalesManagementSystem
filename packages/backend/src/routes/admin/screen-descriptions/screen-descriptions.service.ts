import { Context } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Env } from "../../../types/env";
import { ScreenDescription, ScreenDescriptionPayload } from "./screen-descriptions.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { NotFoundError } from "../../../platform/http/http-error";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { sanitizeHtml } from "../../../platform/html/sanitize-html";
import * as schema from "../../../db/schema";
import * as uiSchema from "../../../db/ui-schema";

const RESOURCE_KEY = "admin_announcements"; // お知らせ管理画面(同じ権限)で編集する

type Row = typeof uiSchema.screenDescriptions.$inferSelect;

// 画面の説明の管理。全画面の見出しが読むため、閲覧は全ユーザー、編集はお知らせ管理と同じ権限(UI側)
export class ScreenDescriptionsService {
  private db(env: Env) {
    return drizzle(env.DB_UI, { schema: uiSchema });
  }

  private toDescription(row: Row): ScreenDescription {
    // 保存時にも無害化しているが、読み出し時にも念のため通す(サニタイズは冪等)
    return { ...row, descriptionHtml: sanitizeHtml(row.descriptionHtml) };
  }

  // 全画面分(件数は画面数程度)。各画面の見出しがログイン後に1度だけ読み込む
  async listAll(env: Env): Promise<ScreenDescription[]> {
    const rows = await this.db(env).select().from(uiSchema.screenDescriptions);
    return rows.map((r) => this.toDescription(r)).sort((a, b) => a.path.localeCompare(b.path));
  }

  preview(body: string) {
    return { html: sanitizeHtml(body) };
  }

  async upsert(c: Context<{ Bindings: Env }>, payload: ScreenDescriptionPayload) {
    const db = this.db(c.env);
    const [before] = await db
      .select()
      .from(uiSchema.screenDescriptions)
      .where(eq(uiSchema.screenDescriptions.path, payload.path));
    const row: Row = {
      path: payload.path,
      descriptionHtml: sanitizeHtml(payload.descriptionHtml),
      updatedBy: await resolveOperatorEmployeeNumber(c, drizzle(c.env.DB, { schema })),
      updatedAt: new Date().toISOString(),
    };
    await db
      .insert(uiSchema.screenDescriptions)
      .values(row)
      .onConflictDoUpdate({
        target: uiSchema.screenDescriptions.path,
        set: { descriptionHtml: row.descriptionHtml, updatedBy: row.updatedBy, updatedAt: row.updatedAt },
      });
    c.executionCtx.waitUntil(
      logAuditEvent(
        c,
        before ? "UPDATE_SCREEN_DESCRIPTION" : "CREATE_SCREEN_DESCRIPTION",
        RESOURCE_KEY,
        payload.path,
        before ? this.toDescription(before) : null,
        this.toDescription(row),
      ),
    );
    return this.toDescription(row);
  }

  // 削除すると、その画面はコードに書かれた既定の説明に戻る
  async remove(c: Context<{ Bindings: Env }>, path: string) {
    const db = this.db(c.env);
    const [target] = await db
      .select()
      .from(uiSchema.screenDescriptions)
      .where(eq(uiSchema.screenDescriptions.path, path));
    if (!target) throw new NotFoundError("この画面の説明は設定されていません");
    await db.delete(uiSchema.screenDescriptions).where(eq(uiSchema.screenDescriptions.path, path));
    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_SCREEN_DESCRIPTION", RESOURCE_KEY, path, this.toDescription(target), null),
    );
    return { success: true };
  }
}
