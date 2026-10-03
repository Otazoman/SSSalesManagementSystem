import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { R2ExplorerService } from "./r2-explorer.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { describeApiRoute, describeMutationRoute } from "../../../platform/openapi/describe-route";
import {
  ListR2ObjectsQuerySchema,
  DeleteR2ObjectPayloadSchema,
  RenameR2ObjectPayloadSchema,
  DownloadR2ObjectQuerySchema,
} from "./r2-explorer.schema";

const r2ExplorerRouter = new Hono<{ Bindings: Env }>();

r2ExplorerRouter.onError((err, c) => respondError(c, err));

const getService = () => new R2ExplorerService();

// ==========================================
// Item13-a: 対象バケット一覧
// ==========================================
r2ExplorerRouter.get(
  "/buckets",
  describeApiRoute({
    summary: "R2バケット一覧取得",
    tags: ["r2-explorer"],
    responses: { 200: { description: "ブラウズ可能なバケット一覧" } },
  }),
  async (c) => {
    return c.json(getService().listBuckets());
  },
);

// ==========================================
// Item13-a: バケット内のオブジェクト一覧(フォルダ・ファイル)
// ==========================================
r2ExplorerRouter.get(
  "/objects",
  describeApiRoute({
    summary: "R2オブジェクト一覧取得",
    tags: ["r2-explorer"],
    query: ListR2ObjectsQuerySchema,
    responses: {
      200: { description: "指定バケット・プレフィックス配下のフォルダ・ファイル一覧" },
      400: { description: "クエリパラメータ不正" },
    },
  }),
  async (c) => {
    const parsed = v.safeParse(ListR2ObjectsQuerySchema, c.req.query());
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const result = await getService().listObjects(c, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// Item13-a: ファイル削除
// ==========================================
r2ExplorerRouter.post(
  "/objects/delete",
  describeMutationRoute({
    summary: "R2オブジェクト削除",
    tags: ["r2-explorer"],
    json: DeleteR2ObjectPayloadSchema,
    successDescription: "削除成功",
    errors: [
      { status: 400, description: "入力データ検証エラー" },
      { status: 404, description: "対象ファイルが見つからない" },
    ],
  }),
  async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    const parsed = v.safeParse(DeleteR2ObjectPayloadSchema, rawBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const result = await getService().deleteObject(c, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// Item13-a: ファイル名変更(取得→新キーへ書込→旧キー削除)
// ==========================================
r2ExplorerRouter.post(
  "/objects/rename",
  describeMutationRoute({
    summary: "R2オブジェクトのファイル名変更",
    tags: ["r2-explorer"],
    json: RenameR2ObjectPayloadSchema,
    successDescription: "変更成功",
    errors: [
      { status: 400, description: "入力データ検証エラー、または変更後のファイル名が既に使用されている" },
      { status: 404, description: "対象ファイルが見つからない" },
    ],
  }),
  async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    const parsed = v.safeParse(RenameR2ObjectPayloadSchema, rawBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const result = await getService().renameObject(c, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 追加要望L-3-d: ダウンロード
// ==========================================
r2ExplorerRouter.get(
  "/objects/download",
  describeApiRoute({
    summary: "R2オブジェクトのダウンロード",
    tags: ["r2-explorer"],
    query: DownloadR2ObjectQuerySchema,
    responses: { 200: { description: "ファイル本体(attachment)" }, 404: { description: "対象ファイルが見つからない" } },
  }),
  async (c) => {
    const parsed = v.safeParse(DownloadR2ObjectQuerySchema, c.req.query());
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const file = await getService().downloadObject(c, parsed.output);
    return new Response(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.size),
        // 日本語ファイル名対応(RFC 5987)
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      },
    });
  },
);

// ==========================================
// 追加要望L-3-d: アップロード(multipart/form-data: bucket, prefix, file, overwrite)
// ==========================================
r2ExplorerRouter.post(
  "/objects/upload",
  describeApiRoute({
    summary: "R2オブジェクトのアップロード",
    tags: ["r2-explorer"],
    responses: {
      200: { description: "アップロード成功" },
      400: { description: "入力不正・同名ファイルあり(上書き未指定)・サイズ超過" },
    },
  }),
  async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    const bucket = form?.get("bucket");
    if (!form || !(file instanceof File) || typeof bucket !== "string") {
      return c.json({ success: false, message: "bucketとfileを指定してください" }, 400);
    }
    const prefix = form.get("prefix");
    const result = await getService().uploadObject(c, {
      bucket,
      prefix: typeof prefix === "string" ? prefix : "",
      file,
      overwrite: form.get("overwrite") === "true",
    });
    return c.json(result);
  },
);

export { r2ExplorerRouter };
