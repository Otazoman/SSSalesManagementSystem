import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { Env } from "../../types/env";
import type { CompiledLayout } from "./types";
import type { ReportPdfSource } from "report-renderer";

/**
 * PERF-07 B-3: 帳票の Excel テンプレート(mailTemplateSettings)がアップロード・コンパイル済み(reportLayoutStatus==='READY')なら、
 * 変換済みのレイアウト(layout.json)と差し込む値を返す。テンプレートが無い・未コンパイル・読み込みや差し込む値の作成に失敗した時は null
 * (呼び出し元は既定のレイアウトで描く)。以前の tryRender…FromCustomTemplate の、描画の手前までと同じ判定。
 * 差し込む値はテンプレートが有効な時だけ作るため、値の作成は呼び出し元から関数で受け取る。
 */
export async function loadCustomLayoutSource(
  env: Env,
  templateId: string,
  resolve: () => { values: Record<string, string>; items: Record<string, string>[] },
): Promise<ReportPdfSource["customLayout"]> {
  try {
    const db = drizzle(env.DB, { schema });
    const rows = await db
      .select()
      .from(schema.mailTemplateSettings)
      .where(eq(schema.mailTemplateSettings.id, templateId))
      .limit(1);
    const template = rows[0];
    if (!template || template.reportLayoutStatus !== "READY" || !template.reportLayoutPath) {
      return null;
    }
    const layoutObj = await env.SYSTEM_BUCKET.get(template.reportLayoutPath);
    if (!layoutObj) return null;
    const layout: CompiledLayout = JSON.parse(await layoutObj.text());
    const { values, items } = resolve();
    return { layout, values, items };
  } catch (err) {
    console.error(
      `[ReportPdf] カスタムテンプレート(${templateId})の読み込みに失敗、既定のレイアウトへフォールバックします:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
