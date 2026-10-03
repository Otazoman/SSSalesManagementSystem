import * as v from "valibot";
import { D1_DATABASE_KEYS } from "./d1-explorer.constants";

const DatabaseSchema = v.picklist(D1_DATABASE_KEYS, "対象DBが不正です");

export const ListD1TablesQuerySchema = v.object({
  db: DatabaseSchema,
});

export const D1TableQuerySchema = v.object({
  db: DatabaseSchema,
  table: v.pipe(v.string(), v.minLength(1, "テーブル名は必須です")),
});

export const ListD1RowsQuerySchema = v.object({
  db: DatabaseSchema,
  table: v.pipe(v.string(), v.minLength(1, "テーブル名は必須です")),
  page: v.optional(v.string()),
  pageSize: v.optional(v.string()),
});

// 主キー列名→値。全主キー列の指定が必須(service側で検証)
const KeySchema = v.record(v.string(), v.union([v.string(), v.number()]));

export const D1RowQuerySchema = v.object({
  db: DatabaseSchema,
  table: v.pipe(v.string(), v.minLength(1, "テーブル名は必須です")),
  // JSON文字列({"id":"X"})
  key: v.pipe(v.string(), v.minLength(2, "keyは必須です")),
});

export const UpdateD1RowPayloadSchema = v.object({
  db: DatabaseSchema,
  table: v.pipe(v.string(), v.minLength(1, "テーブル名は必須です")),
  key: KeySchema,
  values: v.pipe(
    v.record(v.string(), v.nullable(v.union([v.string(), v.number(), v.boolean()]))),
    v.check((r) => Object.keys(r).length > 0, "更新する列を1つ以上指定してください"),
  ),
});

export const DeleteD1RowPayloadSchema = v.object({
  db: DatabaseSchema,
  table: v.pipe(v.string(), v.minLength(1, "テーブル名は必須です")),
  key: KeySchema,
  // 誤操作防止: テーブル名の再入力(削除の確認)
  confirmTable: v.string(),
});

export type D1RowQuery = v.InferOutput<typeof D1RowQuerySchema>;
export type UpdateD1RowPayload = v.InferOutput<typeof UpdateD1RowPayloadSchema>;
export type DeleteD1RowPayload = v.InferOutput<typeof DeleteD1RowPayloadSchema>;
export type ListD1TablesQuery = v.InferOutput<typeof ListD1TablesQuerySchema>;
export type D1TableQuery = v.InferOutput<typeof D1TableQuerySchema>;
export type ListD1RowsQuery = v.InferOutput<typeof ListD1RowsQuerySchema>;
