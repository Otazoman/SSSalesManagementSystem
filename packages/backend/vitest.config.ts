import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  // drizzle/main・drizzle/log のmigrationを読み込み、テスト用ローカルD1に適用できる形にする。
  // migrationファイル自体はここでは変更しない(読み取るのみ)。
  const mainMigrationsPath = path.join(import.meta.dirname, "drizzle/main");
  const mainMigrations = await readD1Migrations(mainMigrationsPath);
  const logMigrationsPath = path.join(import.meta.dirname, "drizzle/log");
  const logMigrations = await readD1Migrations(logMigrationsPath);
  const otpMigrationsPath = path.join(import.meta.dirname, "drizzle/otp");
  const otpMigrations = await readD1Migrations(otpMigrationsPath);
  const journalMigrationsPath = path.join(import.meta.dirname, "drizzle/journal");
  const journalMigrations = await readD1Migrations(journalMigrationsPath);
  const dealsMigrationsPath = path.join(import.meta.dirname, "drizzle/deals");
  const dealsMigrations = await readD1Migrations(dealsMigrationsPath);
  const uiMigrationsPath = path.join(import.meta.dirname, "drizzle/ui");
  const uiMigrations = await readD1Migrations(uiMigrationsPath);

  // PDF生成のテスト用: workerdサンドボックス内のnode:fsには実ファイルシステムへのアクセス権が
  // 無く(nodejs_compat有効でも同一パッケージ内のpackage.json読み取りすら失敗することを確認済み)、
  // テストからR2の実フォントファイルと同等のバイト列を得る手段が無い。migrationファイルと同じ
  // 手法(Node側=このconfig自体の実行環境で読み込み、base64文字列としてbindingで渡す)を使う
  const fontPath = path.join(import.meta.dirname, "../../fonts/LINESeedJP_TTF_Rg.ttf");
  const testFontBase64 = readFileSync(fontPath).toString("base64");

  // 帳票テンプレートのサンプル(samplereport/*.xlsx)の検証テスト用: フォントと同じ手法で、Node側で読み込んで
  // base64文字列(ファイル名→内容)としてbindingで渡す
  const sampleReportDir = path.join(import.meta.dirname, "../../samplereport");
  const testSampleReports = Object.fromEntries(
    readdirSync(sampleReportDir)
      .filter((f) => f.endsWith(".xlsx"))
      .map((f) => [f, readFileSync(path.join(sampleReportDir, f)).toString("base64")]),
  );

  return {
    resolve: {
      alias: {
        // pdf-libが依存するpakoの通常のCJSエントリ(index.js)は相対requireの連鎖を持ち、
        // workerdの厳格なモジュール解決に失敗する。自己完結型のUMDバンドル(dist/pako.js、
        // browserifyによりrequire連鎖が事前解決済み)へ差し替えることで読み込み可能にする。
        // 実装自体はテスト専用差し替えではなく本物のpakoのまま(@pdf-lib/standard-fontsが
        // importと同時にpako.inflate()でフォントデータを展開するため、本物の実装が必要)。
        pako: path.join(import.meta.dirname, "node_modules/pako/dist/pako.js"),
      },
    },
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      // scripts/ のテスト(DB ドキュメントの生成など)は Node 標準のテスト(node --test)で書いているため、
      // Vitest の対象から外す(実行方法は docs/development/testing.md)
      exclude: ["**/node_modules/**", "scripts/**"],
    },
    plugins: [
      // 💡 wrangler.jsoncの`main`(src/index.ts、pdf-lib等を含むアプリ全体)は読み込まない。
      //    pdf-libが依存するpako(CommonJS)がworkerdの厳格なモジュール解決で読み込めず、
      //    platform/配下の純粋な関数テストには不要なため、D1バインディングだけを直接指定する。
      cloudflareTest({
        miniflare: {
          compatibilityDate: "2026-06-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: {
            DB: "test-main-db",
            DB_LOG: "test-log-db",
            DB_OTP: "test-otp-db",
            DB_JOURNAL: "test-journal-db",
            DB_DEALS: "test-deals-db",
            DB_UI: "test-ui-db",
          },
          kvNamespaces: {
            COMPANY_SETTINGS: "test-company-settings",
            KV_PERMISSIONS: "test-kv-permissions",
          },
          r2Buckets: {
            SYSTEM_BUCKET: "test-system-bucket",
            QUATES_BUCKET: "test-quates-bucket",
            PRODUCTS_BUCKET: "test-products-bucket",
            PARTNERS_BUCKET: "test-partners-bucket",
            WAREHOUSES_BUCKET: "test-warehouses-bucket",
            SHIPMENT_INSTRUCTIONS_BUCKET: "test-shipment-instructions-bucket",
            RECEIPT_INSTRUCTIONS_BUCKET: "test-receipt-instructions-bucket",
            // 追加要望L-3-a: モジュール別に分離したバケット
            SALES_ORDERS_BUCKET: "test-sales-orders-bucket",
            SALES_INVOICES_BUCKET: "test-sales-invoices-bucket",
            BILLING_BUCKET: "test-billing-bucket",
            PURCHASE_RECOGNITIONS_BUCKET: "test-purchase-recognitions-bucket",
            ACCEPTANCE_INSPECTIONS_BUCKET: "test-acceptance-inspections-bucket",
            // 追加要望M-1: 商談の添付ファイル専用
            DEALS_BUCKET: "test-deals-bucket",
          },
          bindings: {
            TEST_MIGRATIONS: mainMigrations,
            TEST_LOG_MIGRATIONS: logMigrations,
            TEST_OTP_MIGRATIONS: otpMigrations,
            TEST_JOURNAL_MIGRATIONS: journalMigrations,
            TEST_DEALS_MIGRATIONS: dealsMigrations,
            TEST_UI_MIGRATIONS: uiMigrations,
            TEST_FONT_BASE64: testFontBase64,
            TEST_SAMPLE_REPORTS: testSampleReports,
            FRONTEND_URL: "http://localhost:3000",
          },
          // #14-2: SETUP_TOKEN・API_KEY・SESSION_SECRETはSecrets Store化したため、
          // 単純な文字列bindingではなくsecretsStoreSecretsで定義する。値自体は
          // test/apply-migrations.ts(setupFiles、全テストで1回だけ実行)で
          // adminSecretsStore().create()により登録する
          secretsStoreSecrets: {
            SETUP_TOKEN: { store_id: "test-store", secret_name: "SETUP_TOKEN" },
            API_KEY: { store_id: "test-store", secret_name: "API_KEY" },
            SESSION_SECRET: { store_id: "test-store", secret_name: "SESSION_SECRET" },
          },
        },
      }),
    ],
  };
});
