// PERF-07 B-1: 帳票 PDF の描画のコード(以前は backend の utils/pdfGenerator.ts・platform/report-templates/ にあった)。
// DB・R2・Hono に依存しない。フォント・ロゴ・社印は ArrayBuffer で受け取り、PDF は Uint8Array で返す。
// backend と frontend(ブラウザで PDF を作る。B-5)の両方から使う。
export * from "./pdf-generator";
export * from "./generate-instruction-pdf";
export * from "./render-layout-pdf";
export * from "./compute-render-pages";
export * from "./compute-render-instructions";
export * from "./fit-text";
export * from "./format-values";
export * from "./compute-quote-amount-breakdown";
export * from "./compute-tax-amounts";
export * from "./types";
export * from "./render-report-pdf";
