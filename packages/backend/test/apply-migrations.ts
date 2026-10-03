import { adminSecretsStore, applyD1Migrations, env } from "cloudflare:test";

// テスト用ローカルD1(DB・DB_LOG・DB_OTP・DB_JOURNAL・DB_DEALS・DB_UI)に対して、既存のmain/log/otp/journal/deals migrationをそのまま適用する。
// マイグレーションファイル自体は一切変更しない(読み取って適用するのみ)。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.DB_LOG, env.TEST_LOG_MIGRATIONS);
await applyD1Migrations(env.DB_OTP, env.TEST_OTP_MIGRATIONS);
await applyD1Migrations(env.DB_JOURNAL, env.TEST_JOURNAL_MIGRATIONS);
await applyD1Migrations(env.DB_DEALS, env.TEST_DEALS_MIGRATIONS);
await applyD1Migrations(env.DB_UI, env.TEST_UI_MIGRATIONS);

// #14-2: SETUP_TOKEN・API_KEY・SESSION_SECRETはSecrets Store化した(vitest.config.tsの
// secretsStoreSecrets参照)。バインディングは自動生成されるが値は未設定(get()がthrowする)ため、
// テスト全体で1回だけ値を登録する
await adminSecretsStore(env.SETUP_TOKEN).create("test-setup-token");
await adminSecretsStore(env.API_KEY).create("test-api-key");
await adminSecretsStore(env.SESSION_SECRET).create("test-session-secret");
