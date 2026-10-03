import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { Env } from "../types/env";
import { compileTemplateLayout } from "../platform/report-templates/compile-template";

// Item4-a: 帳票Excelテンプレート(xlsx)のコンパイル(layout.json生成)をCron Trigger(1分間隔)から処理する。
// アップロード/削除時にreportLayoutStatus='PENDING'がセットされ、ここで1件ずつ非同期に処理する。
// 技術検証(2026-08-14)により、この処理は同期リクエスト内では実行できない(CPU予算10ms/リクエストに対し実測7〜11ms)ため、
// 1tickにつき最大1件のみ処理する(通知outboxのバッチ処理とは別に、同一tick内で追加のCPU時間を消費するため保守的に1件に限定)。
export async function processReportTemplateCompiles(env: Env): Promise<void> {
  const db = drizzle(env.DB, { schema });

  const pending = await db
    .select()
    .from(schema.mailTemplateSettings)
    .where(eq(schema.mailTemplateSettings.reportLayoutStatus, "PENDING"))
    .limit(1);

  if (pending.length === 0) return;
  const row = pending[0];

  if (!row.reportTemplatePath) {
    // 通常は発生しない(アップロード時に必ずreportTemplatePathとPENDINGを同時にセットするため)が、
    // 不整合な場合は無限リトライを避けるためFAILEDにしておく
    await db
      .update(schema.mailTemplateSettings)
      .set({
        reportLayoutStatus: "FAILED",
        reportLayoutError: "reportTemplatePathが設定されていません。",
      })
      .where(eq(schema.mailTemplateSettings.id, row.id));
    return;
  }

  try {
    const obj = await env.SYSTEM_BUCKET.get(row.reportTemplatePath);
    if (!obj) {
      throw new Error(
        `R2にテンプレートファイルが見つかりません: ${row.reportTemplatePath}`,
      );
    }

    const buffer = await obj.arrayBuffer();
    const layout = await compileTemplateLayout(buffer);
    const layoutPath = row.reportTemplatePath.replace(/\.xlsx$/i, ".layout.json");

    await env.SYSTEM_BUCKET.put(layoutPath, JSON.stringify(layout), {
      httpMetadata: { contentType: "application/json" },
    });

    await db
      .update(schema.mailTemplateSettings)
      .set({
        reportLayoutStatus: "READY",
        reportLayoutPath: layoutPath,
        reportLayoutError: null,
      })
      .where(eq(schema.mailTemplateSettings.id, row.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ReportTemplateCompileError] id=${row.id} path=${row.reportTemplatePath}:`,
      message,
    );
    await db
      .update(schema.mailTemplateSettings)
      .set({
        reportLayoutStatus: "FAILED",
        reportLayoutError: message,
      })
      .where(eq(schema.mailTemplateSettings.id, row.id));
  }
}
