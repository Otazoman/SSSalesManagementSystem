import { appendPdfPages, generateDocumentPDF, type PDFInvoiceData } from "./pdf-generator";
import { generateInstructionPdf, type InstructionPdfData } from "./generate-instruction-pdf";
import { renderLayoutToPdf } from "./render-layout-pdf";
import type { CompiledLayout } from "./types";

/**
 * PERF-07 B-3: 帳票 PDF を作るためのデータ(GET /:id/pdf-source の応答)。JSON のまま送れる形にしている。
 * - customLayout: 帳票の Excel テンプレートが有効なら、その変換済みのレイアウトと差し込む値。無ければ null
 * - fallback: 既定のレイアウトで描く時のデータ(帳票の様式 document か、指示書の様式 instruction)
 * - appendDocuments: 後ろに付ける帳票(見積書の「ご発注書」。ロゴ・社印は付けない)
 */
export interface ReportPdfSource {
  documentType: string;
  customLayout: {
    layout: CompiledLayout;
    values: Record<string, string>;
    items: Record<string, string>[];
  } | null;
  fallback:
    | { kind: "document"; data: PDFInvoiceData }
    | { kind: "instruction"; data: InstructionPdfData };
  appendDocuments?: PDFInvoiceData[];
}

export interface ReportPdfAssets {
  fontBuffer: ArrayBuffer;
  logoBuffer?: ArrayBuffer | null;
  sealBuffer?: ArrayBuffer | null;
}

/**
 * ReportPdfSource から PDF を作る(ブラウザ・サーバーで同じ処理)。
 * 以前の各 *-pdf.service.ts と同じ順番: Excel テンプレートで描き、無い・失敗した時は既定のレイアウトで描く。
 * その後ろに appendDocuments を付ける。
 */
export async function renderReportPdf(
  source: ReportPdfSource,
  assets: ReportPdfAssets,
): Promise<Uint8Array> {
  let pdf: Uint8Array | null = null;
  if (source.customLayout) {
    try {
      pdf = await renderLayoutToPdf(
        source.customLayout.layout,
        source.customLayout.values,
        source.customLayout.items,
        assets.fontBuffer,
      );
    } catch (err) {
      console.error(
        `[ReportPdf] ${source.documentType}: カスタムテンプレートでの生成に失敗、既定のレイアウトへフォールバックします:`,
        err instanceof Error ? err.message : err,
      );
      pdf = null;
    }
  }

  if (!pdf) {
    const resources = {
      fontBuffer: assets.fontBuffer,
      logoBuffer: assets.logoBuffer ?? null,
      sealBuffer: assets.sealBuffer ?? null,
    };
    pdf =
      source.fallback.kind === "document"
        ? await generateDocumentPDF(source.fallback.data, resources)
        : await generateInstructionPdf(source.fallback.data, resources);
  }

  for (const extra of source.appendDocuments ?? []) {
    const extraPdf = await generateDocumentPDF(extra, {
      fontBuffer: assets.fontBuffer,
      logoBuffer: null,
      sealBuffer: null,
    });
    pdf = await appendPdfPages(pdf, extraPdf);
  }
  return pdf;
}
