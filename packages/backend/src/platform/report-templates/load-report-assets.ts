import { Env } from "../../types/env";
import type { ReportPdfAssets } from "report-renderer";

/**
 * PERF-07: サーバーで PDF を作る時の、フォント・ロゴ・社印(以前は各 *-pdf.service.ts が同じ処理を持っていた)。
 * フォントが無い時は missingFont() のエラーを投げる(帳票ごとのメッセージを変えないため、呼び出し元から受け取る)。
 */
export async function loadReportAssets(
  env: Env,
  missingFont: () => Error = () => new Error("日本語フォントファイルがR2に見つかりません"),
): Promise<ReportPdfAssets> {
  const [fontRes, logoRes, sealRes] = await Promise.all([
    env.SYSTEM_BUCKET.get("fonts/company_fonts.ttf"),
    env.SYSTEM_BUCKET.get("company/company_logo.png"),
    env.SYSTEM_BUCKET.get("company/company_seal.png"),
  ]);
  if (!fontRes) throw missingFont();
  return {
    fontBuffer: await fontRes.arrayBuffer(),
    logoBuffer: logoRes ? await logoRes.arrayBuffer() : null,
    sealBuffer: sealRes ? await sealRes.arrayBuffer() : null,
  };
}
