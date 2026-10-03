import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Next.jsアプリ本体(React)は対象外。proxy.ts(Cloudflare Worker本体)専用の軽量テスト基盤。
export default defineConfig({
  test: {
    include: ["proxy.test.ts"],
  },
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-06-01",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          API_KEY: "test-api-key",
          SESSION_SECRET: "test-session-secret",
        },
      },
    }),
  ],
});
