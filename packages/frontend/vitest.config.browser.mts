import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// 画面幅別の表示確認(実ブラウザ)。jsdomはCSSを評価しないため、レスポンシブの崩れ(横はみ出し等)はここで検出する。
// 実行: npm run test:browser(初回のみ `npx playwright install chromium` が必要)。
// 対象は app/**/*.browser.test.tsx。Tailwindは postcss.config.mjs 経由で globals.css を読み込む。
export default defineConfig({
  // 初回実行で依存の最適化による再読み込み(テストの不安定化)が起きないよう、使う依存を先に指定する
  optimizeDeps: {
    include: [
      "react",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "@testing-library/react",
      "next/navigation",
    ],
  },
  test: {
    include: ["app/**/*.browser.test.{ts,tsx}"],
    setupFiles: ["./vitest.browser.setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
