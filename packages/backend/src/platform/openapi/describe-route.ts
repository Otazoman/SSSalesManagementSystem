import { describeRoute } from "hono-openapi";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { BaseSchema, BaseIssue } from "valibot";

type AnySchema = BaseSchema<unknown, unknown, BaseIssue<unknown>>;

// 既存スキーマの大半はv.transform()(trim・大文字化等)を含んでおり、これらはJSON Schemaで表現不能なため、
// デフォルトの"throw"のままだとdescribeApiRoute呼び出し自体がエラーになる。ドキュメント生成はベストエフォートで
// 十分なため、変換不能なactionは無視して残りの構造(型・必須項目等)だけを出力する。
const TO_JSON_SCHEMA_CONFIG = { errorMode: "ignore" as const };

/** `{ success, message }`形状のレスポンス(登録・更新・削除系エンドポイントの大半で使われる共通形状) */
export const successMessageSchema = v.object({
  success: v.boolean(),
  message: v.string(),
});

interface ResponseDoc {
  description: string;
  /** 既存のvalibotスキーマ、またはレスポンス形状を表すためだけに追加したスキーマ */
  schema?: AnySchema;
}

interface DescribeApiRouteOptions {
  summary: string;
  tags: string[];
  /** 既存の`vValidator("json", schema)`と同じスキーマをそのまま渡す(バリデーションロジック自体は変更しない) */
  json?: AnySchema;
  /** 既存の`vValidator("form", schema)`と同じスキーマをそのまま渡す(multipart/form-data) */
  form?: AnySchema;
  /** 既存の`vValidator("query", schema)`と同じスキーマをそのまま渡す */
  query?: AnySchema;
  responses: Record<number, ResponseDoc>;
}

/**
 * 既存のvalibotスキーマ(vValidatorへ渡しているものと同一)からOpenAPIドキュメントを組み立てる。
 * vValidator自体は置き換えない(実行時のバリデーション挙動は一切変更しない、追加のみ)。
 * resolver()経由の自動解決はresponsesにしか効かないため(hono-openapiの実装上の制約)、
 * requestBody/parametersも含めtoJsonSchema()で自前解決したプレーンなJSON Schemaを渡す。
 */
export function describeApiRoute(opts: DescribeApiRouteOptions) {
  const responses: Record<string, unknown> = {};
  for (const [status, doc] of Object.entries(opts.responses)) {
    responses[status] = {
      description: doc.description,
      ...(doc.schema
        ? { content: { "application/json": { schema: toJsonSchema(doc.schema, TO_JSON_SCHEMA_CONFIG) } } }
        : {}),
    };
  }

  const spec: Record<string, unknown> = {
    summary: opts.summary,
    tags: opts.tags,
    responses,
  };

  if (opts.json) {
    spec.requestBody = {
      required: true,
      content: { "application/json": { schema: toJsonSchema(opts.json, TO_JSON_SCHEMA_CONFIG) } },
    };
  }

  if (opts.form) {
    spec.requestBody = {
      required: true,
      content: {
        "multipart/form-data": { schema: toJsonSchema(opts.form, TO_JSON_SCHEMA_CONFIG) },
      },
    };
  }

  if (opts.query) {
    const querySchema = toJsonSchema(opts.query, TO_JSON_SCHEMA_CONFIG) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const required = querySchema.required ?? [];
    spec.parameters = Object.entries(querySchema.properties ?? {}).map(
      ([name, propSchema]) => ({
        name,
        in: "query",
        required: required.includes(name),
        schema: propSchema,
      }),
    );
  }

  return describeRoute(spec);
}

export interface ErrorResponseDoc {
  status: number;
  description: string;
}

/**
 * 一覧取得系(GET /)向けプリセット。Backend 2-4で全一覧APIに共通導入したページネーション仕様
 * (page/limit未指定時は配列、指定時のみ{data,pagination}形式)の説明文を毎回書かずに済むようにする。
 */
export function describeListRoute(opts: {
  summary: string;
  tags: string[];
  query?: AnySchema;
  /** 一覧の中身の説明(例: "単位マスタ")。省略可 */
  itemDescription?: string;
}) {
  const prefix = opts.itemDescription ? `${opts.itemDescription}の一覧。` : "";
  return describeApiRoute({
    summary: opts.summary,
    tags: opts.tags,
    query: opts.query,
    responses: {
      200: {
        description: `${prefix}page/limitクエリパラメータ未指定時は配列をそのまま返す。指定時のみ{data,pagination}形式で返す(後方互換)。`,
      },
    },
  });
}

/**
 * 登録・更新系(POST/PUT)向けプリセット。`{success, message}`形状の成功・エラーレスポンスが
 * 大半のfeatureで共通のため、その組み立てを省略できるようにする。
 */
export function describeMutationRoute(opts: {
  summary: string;
  tags: string[];
  json?: AnySchema;
  successDescription?: string;
  errors?: ErrorResponseDoc[];
}) {
  const responses: Record<number, ResponseDoc> = {
    200: { description: opts.successDescription ?? "処理成功", schema: successMessageSchema },
  };
  for (const err of opts.errors ?? []) {
    responses[err.status] = { description: err.description, schema: successMessageSchema };
  }
  return describeApiRoute({
    summary: opts.summary,
    tags: opts.tags,
    json: opts.json,
    responses,
  });
}

/** 削除系(DELETE)向けプリセット。jsonボディを取らない点のみ`describeMutationRoute`と異なる。 */
export function describeDeleteRoute(opts: {
  summary: string;
  tags: string[];
  successDescription?: string;
  errors?: ErrorResponseDoc[];
}) {
  return describeMutationRoute({ ...opts, json: undefined });
}

/** CSVダウンロード系(GET、`text/csv`を返す)向けプリセット。 */
export function describeCsvDownloadRoute(opts: { summary: string; tags: string[] }) {
  return describeApiRoute({
    summary: opts.summary,
    tags: opts.tags,
    responses: {
      200: { description: "BOM付きCSVファイル(text/csv)" },
    },
  });
}

/**
 * CSVインポート系(POST、`multipart/form-data`)向けプリセット。
 * ファイルアップロードのためrequestBodyのスキーマ化はせず概要のみ記載する。
 */
export function describeCsvImportRoute(opts: {
  summary: string;
  tags: string[];
  successDescription?: string;
  errors?: ErrorResponseDoc[];
}) {
  const responses: Record<number, ResponseDoc> = {
    200: { description: opts.successDescription ?? "インポート成功", schema: successMessageSchema },
  };
  for (const err of opts.errors ?? []) {
    responses[err.status] = { description: err.description, schema: successMessageSchema };
  }
  return describeApiRoute({
    summary: opts.summary,
    tags: opts.tags,
    responses,
  });
}
