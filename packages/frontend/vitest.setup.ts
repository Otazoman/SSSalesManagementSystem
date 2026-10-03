import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.react.mtsでtest.globalsを使わないため、RTLの自動cleanup(afterEach)が
// 暗黙のグローバルに依存せず確実に効くよう、ここで明示的に登録する。
afterEach(() => {
  cleanup();
});
