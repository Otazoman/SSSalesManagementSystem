# report-renderer

帳票 PDF の描画のコードです(PERF-07)。backend(`packages/backend`)と frontend(`packages/frontend`)の両方から、
`"report-renderer": "file:../report-renderer"` で参照します(npm の workspaces は使っていません)。

- DB・R2・Hono に依存しません。フォント・ロゴ・社印は `ArrayBuffer` で受け取り、PDF は `Uint8Array` で返します。
- 依存(pdf-lib・@pdf-lib/fontkit)は、このフォルダの `node_modules` に入れます。backend・frontend をビルド・テストする前に、
  このフォルダで `npm install` を実行してください。
- テストは backend の vitest で行います(`packages/backend/src/platform/report-templates/report-renderer-equivalence.test.ts` など)。
