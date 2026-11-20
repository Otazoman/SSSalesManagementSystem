import { expect, vi } from "vitest";

// PERF-07: ブラウザで PDF を作る時は、pdf-source の応答(ReportPdfSource)を JSON で受け取って描く。
// サーバーで描く時(generate-pdf)と同じ PDF にするには、描画に渡すデータが JSON にしても変わらない
// (Date などが入っていない)必要がある。PDF を作る全てのテストで、描画の入口に渡されたデータを確かめる。
vi.mock("report-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("report-renderer")>();
  return {
    ...actual,
    renderReportPdf: async (...args: Parameters<typeof actual.renderReportPdf>) => {
      const [source] = args;
      expect(JSON.parse(JSON.stringify(source)), `ReportPdfSource(${source.documentType})が JSON で変わる`).toEqual(source);
      return actual.renderReportPdf(...args);
    },
  };
});
