import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBindings, applyStoreId, buildConfig, findStoreId } from "./sync-wrangler.mjs";

const SAMPLE = `{
  // コメントは保たれる
  "d1_databases": [
    { "binding": "DB", "database_name": "my-erp-db", "database_id": "dev-main-db" },
    {
      // DB_LOG(DB の前方一致で誤って書き換えないこと)
      "binding": "DB_LOG",
      "database_name": "my-erp-log-db",
      "database_id": "dev-audit-log-db",
    },
  ],
  "r2_buckets": [{ "binding": "SYSTEM_BUCKET", "bucket_name": "system" }],
  "kv_namespaces": [{ "binding": "COMPANY_SETTINGS", "id": "xxxx_PLACEHOLDER_xxxx" }],
}`;

const BINDINGS = {
  d1: {
    DB: { database_name: "my-erp-db-staging", database_id: "id-main" },
    DB_LOG: { database_name: "my-erp-log-db-staging", database_id: "id-log" },
    DB_NEW: { database_name: "x", database_id: "y" },
  },
  r2: { SYSTEM_BUCKET: { bucket_name: "system-staging" } },
  kv: { COMPANY_SETTINGS: { id: "kv-id-1" } },
};

test("バインディング名ごとに値だけを書き換え、コメントは保つ", () => {
  const { text, changes } = applyBindings(SAMPLE, BINDINGS);
  assert.match(text, /"binding": "DB", "database_name": "my-erp-db-staging", "database_id": "id-main"/);
  assert.match(text, /"database_id": "id-log"/);
  assert.match(text, /"bucket_name": "system-staging"/);
  assert.match(text, /"id": "kv-id-1"/);
  assert.match(text, /\/\/ コメントは保たれる/);
  assert.match(text, /\/\/ DB_LOG\(DB の前方一致/);
  assert.equal(changes.length, 6);
});

test("wrangler.jsonc に無いバインディングは missing に集め、エラーにしない", () => {
  const { missing } = applyBindings(SAMPLE, BINDINGS);
  assert.deepEqual(missing, ["d1:DB_NEW"]);
});

test("すでに反映済みなら変更なし(2回目は差分が出ない)", () => {
  const first = applyBindings(SAMPLE, BINDINGS);
  const second = applyBindings(first.text, BINDINGS);
  assert.deepEqual(second.changes, []);
  assert.equal(second.text, first.text);
});

test("出力に必要な値が無ければエラー", () => {
  assert.throws(() => applyBindings(SAMPLE, { d1: { DB: { database_name: "a" } } }), /database_id/);
});

// #14-2①: env.staging(named environment)を持つファイル。バインディング名がtop-level(production)
// とenv.staging側の両方に同じ名前で出てくる(D1は無料プラン上限のためstagingで2つのバインディングを
// 同じ物理データベースにまとめている点も再現する)
const WITH_ENV = `{
  "d1_databases": [
    { "binding": "DB", "database_name": "my-erp-db", "database_id": "dev-main-db" },
    { "binding": "DB_LOG", "database_name": "my-erp-log-db", "database_id": "dev-audit-log-db" },
  ],
  "kv_namespaces": [{ "binding": "COMPANY_SETTINGS", "id": "xxxx_PLACEHOLDER_xxxx" }],
  "env": {
    "staging": {
      "d1_databases": [
        { "binding": "DB", "database_name": "my-erp-db-staging", "database_id": "dev-main-db-staging" },
        { "binding": "DB_LOG", "database_name": "my-erp-shared-db-staging", "database_id": "dev-shared-db-staging" },
        { "binding": "DB_OTP", "database_name": "my-erp-shared-db-staging", "database_id": "dev-shared-db-staging" },
      ],
      "kv_namespaces": [{ "binding": "COMPANY_SETTINGS", "id": "yyyy_PLACEHOLDER_STAGING_yyyy" }],
    },
  },
}`;

test("productionはenv.staging側を書き換えない(トップレベルだけを対象にする)", () => {
  const { text, changes } = applyBindings(
    WITH_ENV,
    { d1: { DB: { database_name: "my-erp-db", database_id: "prod-main-id" } } },
    "production",
  );
  assert.match(text, /"binding": "DB", "database_name": "my-erp-db", "database_id": "prod-main-id"/);
  // env.staging側のDBはそのまま(書き換わっていない)
  assert.match(text, /"binding": "DB", "database_name": "my-erp-db-staging", "database_id": "dev-main-db-staging"/);
  assert.equal(changes.length, 1);
});

test("stagingはenv.staging側だけを書き換え、トップレベル(production)には触れない", () => {
  const { text, changes } = applyBindings(
    WITH_ENV,
    { d1: { DB: { database_name: "my-erp-db-staging", database_id: "real-main-id" } } },
    "staging",
  );
  // トップレベルのDBはそのまま
  assert.match(text, /"binding": "DB", "database_name": "my-erp-db", "database_id": "dev-main-db"/);
  // env.staging側のDBだけ書き換わる
  assert.match(text, /"binding": "DB", "database_name": "my-erp-db-staging", "database_id": "real-main-id"/);
  assert.equal(changes.length, 1);
});

test("staging: 同じ物理データベースを指す複数バインディング(DB_LOG/DB_OTP)を両方とも正しく書き換える", () => {
  const { text, changes } = applyBindings(
    WITH_ENV,
    {
      d1: {
        DB_LOG: { database_name: "my-erp-shared-db-staging", database_id: "real-shared-id" },
        DB_OTP: { database_name: "my-erp-shared-db-staging", database_id: "real-shared-id" },
      },
    },
    "staging",
  );
  assert.match(text, /"binding": "DB_LOG", "database_name": "my-erp-shared-db-staging", "database_id": "real-shared-id"/);
  assert.match(text, /"binding": "DB_OTP", "database_name": "my-erp-shared-db-staging", "database_id": "real-shared-id"/);
  // database_nameはWITH_ENV側とすでに一致しているため、変わるのはdatabase_idの2件だけ
  assert.equal(changes.length, 2);
});

test("存在しないenv名を指定するとエラー", () => {
  assert.throws(
    () => applyBindings(WITH_ENV, { kv: { COMPANY_SETTINGS: { id: "x" } } }, "no-such-env"),
    /env"\."no-such-env/,
  );
});

// 2026-09-23: wrangler.jsonc.example(ひな形)から wrangler.jsonc を作る方式への変更分
const EXAMPLE = `{
  "d1_databases": [
    { "binding": "DB", "database_name": "my-erp-db", "database_id": "dev-main-db", "preview_database_id": "dev-main-db" },
  ],
  "kv_namespaces": [{ "binding": "COMPANY_SETTINGS", "id": "xxxx_PLACEHOLDER_xxxx", "preview_id": "xxxx_PLACEHOLDER_xxxx" }],
  "secrets_store_secrets": [{ "binding": "API_KEY", "store_id": "SECRETS_STORE_ID_PLACEHOLDER", "secret_name": "API_KEY" }],
  "env": {
    "staging": {
      "d1_databases": [
        { "binding": "DB", "database_name": "my-erp-db-staging", "database_id": "dev-main-db-staging" },
      ],
      "secrets_store_secrets": [{ "binding": "API_KEY", "store_id": "SECRETS_STORE_ID_PLACEHOLDER", "secret_name": "API_KEY_STAGING" }],
    },
  },
}`;

test("実IDを埋めても、ローカル用の preview_database_id / preview_id は仮の値のまま残す", () => {
  const { text } = applyBindings(
    EXAMPLE,
    { d1: { DB: { database_name: "my-erp-db", database_id: "prod-main-id" } }, kv: { COMPANY_SETTINGS: { id: "prod-kv-id" } } },
    "production",
  );
  assert.match(text, /"database_id": "prod-main-id", "preview_database_id": "dev-main-db"/);
  assert.match(text, /"id": "prod-kv-id", "preview_id": "xxxx_PLACEHOLDER_xxxx"/);
});

test("applyStoreId: 本番・stagingの store_id をすべて同じストアIDに置き換える", () => {
  const { text, changes } = applyStoreId(EXAMPLE, "store-123");
  assert.equal(text.match(/"store_id": "store-123"/g).length, 2);
  assert.doesNotMatch(text, /SECRETS_STORE_ID_PLACEHOLDER/);
  assert.equal(changes.length, 2);
});

test("buildConfig: Terraformが未構築(null)の環境は仮の値のまま、構築済みの環境だけ埋める", () => {
  const { text, changes } = buildConfig(EXAMPLE, {
    storeId: null,
    envBindings: {
      production: null,
      staging: { d1: { DB: { database_name: "my-erp-db-staging", database_id: "staging-main-id" } } },
    },
  });
  assert.match(text, /"database_id": "dev-main-db"/); // production は仮の値のまま
  assert.match(text, /"database_id": "staging-main-id"/);
  assert.match(text, /SECRETS_STORE_ID_PLACEHOLDER/); // storeId なしなら store_id も仮の値のまま
  assert.deepEqual(changes, ["[staging] d1:DB.database_id  dev-main-db-staging -> staging-main-id"]);
});

test("buildConfig: 何も構築されていなければひな形と同じ内容になる(ローカル開発用)", () => {
  const { text, changes } = buildConfig(EXAMPLE, { storeId: null, envBindings: { production: null, staging: null } });
  assert.equal(text, EXAMPLE);
  assert.deepEqual(changes, []);
});

test("buildConfig: bindings: false(frontend)は store_id だけを埋める", () => {
  const { text } = buildConfig(EXAMPLE, {
    storeId: "store-123",
    envBindings: { production: { d1: { DB: { database_name: "my-erp-db", database_id: "prod-main-id" } } } },
    bindings: false,
  });
  assert.match(text, /"store_id": "store-123"/);
  assert.match(text, /"database_id": "dev-main-db"/);
});

test("findStoreId: 仮の値やファイル無しは null、実IDならその値(--store-id 省略時の引き継ぎ用)", () => {
  assert.equal(findStoreId(EXAMPLE), null);
  assert.equal(findStoreId(null), null);
  assert.equal(findStoreId(applyStoreId(EXAMPLE, "store-123").text), "store-123");
});
