import * as v from "valibot";
import { R2_BUCKET_REGISTRY } from "./r2-explorer.constants";

const bucketKeys = R2_BUCKET_REGISTRY.map((b) => b.key) as [string, ...string[]];

export const ListR2ObjectsQuerySchema = v.object({
  bucket: v.picklist(bucketKeys, "対象のバケットを指定してください"),
  prefix: v.optional(v.string(), ""),
});

export const DeleteR2ObjectPayloadSchema = v.object({
  bucket: v.picklist(bucketKeys, "対象のバケットを指定してください"),
  key: v.pipe(v.string(), v.minLength(1, "対象ファイルのキーは必須です")),
});

export const RenameR2ObjectPayloadSchema = v.object({
  bucket: v.picklist(bucketKeys, "対象のバケットを指定してください"),
  oldKey: v.pipe(v.string(), v.minLength(1, "変更前のキーは必須です")),
  newKey: v.pipe(v.string(), v.minLength(1, "変更後のキーは必須です")),
});

export const DownloadR2ObjectQuerySchema = v.object({
  bucket: v.picklist(bucketKeys, "対象のバケットを指定してください"),
  key: v.pipe(v.string(), v.minLength(1, "対象ファイルのキーは必須です")),
});

// アップロード1ファイルあたりの上限(Workerのリクエストサイズ・メモリを考慮した画面操作用の制限)
export const R2_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type DownloadR2ObjectQuery = v.InferOutput<typeof DownloadR2ObjectQuerySchema>;
export type ListR2ObjectsQuery = v.InferOutput<typeof ListR2ObjectsQuerySchema>;
export type DeleteR2ObjectPayload = v.InferOutput<typeof DeleteR2ObjectPayloadSchema>;
export type RenameR2ObjectPayload = v.InferOutput<typeof RenameR2ObjectPayloadSchema>;
