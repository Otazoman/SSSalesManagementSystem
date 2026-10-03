export type Env = {
  DB: D1Database;
  DB_LOG: D1Database;
  DB_OTP: D1Database; // Item4-c: 見積書OTPダウンロード用(実バインディングは未作成、設計・テストのみ先行)
  // 仕訳データ用(src/db/journal-schema.ts)。伝票データとは性格が異なるため隔離する。
  // 実バインディングはwrangler d1 create後にwrangler.jsoncへ追記が必要
  DB_JOURNAL: D1Database;
  // 追加要望M-1: 商談管理用(src/db/deals-schema.ts)。営業活動データのため伝票DBとは分離する
  DB_DEALS: D1Database;
  // お知らせ・画面説明・ユーザー表示設定用(src/db/ui-schema.ts)。表示用データのため伝票DBとは分離する
  DB_UI: D1Database;
  // #14-2: Secrets Store化(2026-09-22ユーザー指示)。frontend/backendで共有する値のため、
  // 個別Worker専用のSecret(wrangler secret put)ではなくSecrets Store(1アカウント共有の箱)を使う。
  // .get()は未設定/取得失敗時にthrowする(呼び出し側でtry/catchして扱う。platform/auth/get-session.ts等参照)
  API_KEY: SecretsStoreSecret;
  SESSION_SECRET: SecretsStoreSecret;
  // SETUP_TOKENはbackend専用(共有不要)だが、同じ理由でSecrets Storeに統一する
  SETUP_TOKEN: SecretsStoreSecret;
  FRONTEND_URL: string;
  // APIドキュメント(/api/docs・/api/openapi.json)を公開するか。"true" の時だけ公開する。
  // ローカルの .dev.vars にだけ書き、Staging・本番には登録しない(=404)
  ENABLE_API_DOCS?: string;
  COMPANY_SETTINGS: KVNamespace; // ワークフロー等で使用
  KV_PERMISSIONS: KVNamespace;
  SYSTEM_BUCKET: R2Bucket;
  QUATES_BUCKET: R2Bucket;
  PRODUCTS_BUCKET: R2Bucket; // 商品マスタの添付ファイル
  PARTNERS_BUCKET: R2Bucket; // 取引先マスタの添付ファイル
  WAREHOUSES_BUCKET: R2Bucket; // 倉庫マスタの添付ファイル
  SHIPMENT_INSTRUCTIONS_BUCKET: R2Bucket; // Item6 Phase6-4: 出荷指示書PDF
  RECEIPT_INSTRUCTIONS_BUCKET: R2Bucket; // Item6 Phase6-4: 入荷指示書PDF
  PURCHASE_REQUISITIONS_BUCKET: R2Bucket; // Item9 Phase3: 購買申請の参考添付ファイル
  PURCHASE_ORDERS_BUCKET: R2Bucket; // Item9 Phase5: 発注書PDF・添付ファイル
  // 追加要望L-3-a: モジュール別に分離したバケット(既存ファイルは旧バケットにフォールバック)
  SALES_ORDERS_BUCKET: R2Bucket; // 受注の添付・注文請書PDF(旧: QUATES_BUCKET)
  SALES_INVOICES_BUCKET: R2Bucket; // 売上の添付・売上計上書PDF(旧: QUATES_BUCKET)
  BILLING_BUCKET: R2Bucket; // 請求書PDF(旧: QUATES_BUCKET)
  PURCHASE_RECOGNITIONS_BUCKET: R2Bucket; // 仕入計上の添付・仕入計上書PDF(旧: QUATES_BUCKET)
  ACCEPTANCE_INSPECTIONS_BUCKET: R2Bucket; // 検収書PDF(旧: SYSTEM_BUCKET)
  DEALS_BUCKET: R2Bucket; // 追加要望M-1: 商談の添付ファイル(専用バケット)
  // 今後新しい環境変数（KV_PERMISSIONS など）が増えたらここに1行足すだけ！
  [key: string]: any; // 👈 予期せぬ個別の環境変数の差分でエラーにならないための保険
};
