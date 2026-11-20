// PERF-07 B-1: 帳票の描画のコードは共有パッケージ report-renderer に移した。既存の読み込み先を変えないため、ここから読み込み直す
export * from "report-renderer/compute-quote-amount-breakdown";
