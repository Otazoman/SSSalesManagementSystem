import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { Env } from "../../types/env";
import { InstructionPdfData } from "./generate-instruction-pdf";
import { CompiledLayout } from "./types";
import { renderLayoutToPdf } from "./render-layout-pdf";
import { resolveInstructionPlaceholders } from "./resolve-instruction-placeholders";

// 出荷指示書/入荷指示書/納品書共通: mailTemplateSettings(帳票Excelテンプレート)が
// アップロード・コンパイル済み(reportLayoutStatus==='READY')であればlayout.json駆動でPDFを
// 生成する。テンプレート未登録・未コンパイル・描画失敗時はnullを返し、呼び出し元は
// generateInstructionPdf(既定のpdf-lib直描画)へフォールバックする
// (quote-pdf.service.tsのtryRenderFromCustomTemplateと同じ方針)。
export async function tryRenderInstructionPdfFromCustomTemplate(
  env: Env,
  categoryId: string,
  data: InstructionPdfData,
  fontBuffer: ArrayBuffer,
): Promise<Uint8Array | null> {
  try {
    const db = drizzle(env.DB, { schema });
    const rows = await db
      .select()
      .from(schema.mailTemplateSettings)
      .where(eq(schema.mailTemplateSettings.id, categoryId))
      .limit(1);
    const template = rows[0];
    if (!template || template.reportLayoutStatus !== "READY" || !template.reportLayoutPath) {
      return null;
    }

    const layoutObj = await env.SYSTEM_BUCKET.get(template.reportLayoutPath);
    if (!layoutObj) return null;

    const layout: CompiledLayout = JSON.parse(await layoutObj.text());
    const { values, items } = resolveInstructionPlaceholders(data);
    return await renderLayoutToPdf(layout, values, items, fontBuffer);
  } catch (err) {
    console.error(
      `[InstructionPdf] カスタムテンプレート(${categoryId})での生成に失敗、既定のレイアウトへフォールバックします:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
