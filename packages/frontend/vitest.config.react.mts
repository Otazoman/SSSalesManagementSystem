import { defineConfig } from "vitest/config";

// app/配下のReact hooks・UIコンポーネントのテスト専用設定。
// proxy.ts(Cloudflare Worker本体)はvitest.config.mts(workerdプール)側で別管理のため対象外にする。
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.{ts,tsx}"],
    // 実ブラウザ用(vitest.config.browser.mts)は別実行
    exclude: ["app/**/*.browser.test.{ts,tsx}", "node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
