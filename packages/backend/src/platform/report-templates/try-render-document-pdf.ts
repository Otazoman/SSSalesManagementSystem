import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { Env } from "../../types/env";
import { CompiledLayout } from "./types";
import { renderLayoutToPdf } from "./render-layout-pdf";
import type { ResolvedDocumentPlaceholders } from "./resolve-document-placeholders";

// 請求書/売上計上書/仕入計上書共通: mailTemplateSettings(帳票Excelテンプレート)が
// アップロード・コンパイル済み(reportLayoutStatus==='READY')であればlayout.json駆動でPDFを
// 生成する。テンプレート未登録・未コンパイル・描画失敗時はnullを返し、呼び出し元は
// generateDocumentPDF(既定のpdf-lib直描画)へフォールバックする
// (try-render-instruction-pdf.tsと同じ方針。差し込み値はテンプレートが有効なときだけ作るため、
// 値の作成を呼び出し元から関数で受け取る)。
export async function tryRenderDocumentPdfFromCustomTemplate(
  env: Env,
  templateId: string,
  resolve: () => ResolvedDocumentPlaceholders,
  fontBuffer: ArrayBuffer,
): Promise<Uint8Array | null> {
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
    return await renderLayoutToPdf(layout, values, items, fontBuffer);
  } catch (err) {
    console.error(
      `[DocumentPdf] カスタムテンプレート(${templateId})での生成に失敗、既定のレイアウトへフォールバックします:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
