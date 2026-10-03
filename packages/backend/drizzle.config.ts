import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // 読み込むスキーマ（設計図）のパス
  schema: "./src/db/schema.ts",

  // 生成されたSQL（マイグレーションファイル）の出力先
  out: "./drizzle",

  // 使用するデータベースの種類（D1はSQLiteベース）
  dialect: "sqlite",
});
