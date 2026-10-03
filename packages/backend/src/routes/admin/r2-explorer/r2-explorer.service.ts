import { Context } from "hono";
import { Env } from "../../../types/env";
import { R2_BUCKET_REGISTRY, resolveBucket } from "./r2-explorer.constants";
import {
  ListR2ObjectsQuery,
  DeleteR2ObjectPayload,
  RenameR2ObjectPayload,
  DownloadR2ObjectQuery,
  R2_MAX_UPLOAD_BYTES,
} from "./r2-explorer.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

const RESOURCE_KEY = "admin_r2_explorer";

// Item13-a: R2参照機能(全バケット横断のブラウズ・削除・リネーム)。
// 一覧ロジックはmail-settings.service.tsのlistR2Objects()と同型(踏襲)。
export class R2ExplorerService {
  listBuckets() {
    return R2_BUCKET_REGISTRY.map((b) => ({ key: b.key, label: b.label }));
  }

  async listObjects(c: Context<{ Bindings: Env }>, query: ListR2ObjectsQuery) {
    const bucket = resolveBucket(c.env, query.bucket);
    if (!bucket) throw new BadRequestError(`未知のバケットです: ${query.bucket}`);

    const prefix = query.prefix || "";
    const listed = await bucket.list({ prefix, delimiter: "/" });

    const folders = listed.delimitedPrefixes.map((p) => ({
      name: p.slice(prefix.length).replace(/\/$/, ""),
      path: p,
      type: "folder" as const,
    }));

    const files = listed.objects
      .filter((obj) => obj.key !== prefix)
      .map((obj) => ({
        name: obj.key.slice(prefix.length),
        path: obj.key,
        type: "file" as const,
        size: obj.size,
        contentType: obj.httpMetadata?.contentType || "application/octet-stream",
        uploaded: obj.uploaded,
      }));

    return {
      currentPrefix: prefix,
      parentPrefix: prefix
        ? prefix.split("/").slice(0, -2).join("/") + (prefix.split("/").slice(0, -2).length ? "/" : "")
        : null,
      items: [...folders, ...files],
    };
  }

  // 追加要望L-3-d: ダウンロード。オブジェクトの本体(ストリーム)とメタ情報を返す
  async downloadObject(c: Context<{ Bindings: Env }>, query: DownloadR2ObjectQuery) {
    const bucket = resolveBucket(c.env, query.bucket);
    if (!bucket) throw new BadRequestError(`未知のバケットです: ${query.bucket}`);
    const object = await bucket.get(query.key);
    if (!object) throw new NotFoundError("対象のファイルが見つかりません");

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DOWNLOAD_R2_OBJECT", RESOURCE_KEY, query.key, null, {
        bucket: query.bucket,
        key: query.key,
        size: object.size,
      }),
    );
    return {
      body: object.body,
      fileName: query.key.split("/").pop() || "download",
      contentType: object.httpMetadata?.contentType || "application/octet-stream",
      size: object.size,
    };
  }

  // 追加要望L-3-d: アップロード。フォルダ(prefix)配下へファイルを保存する。
  // 既存キーの上書きは、明示指定(overwrite=true)された場合のみ許可する(業務資産を誤って上書きしないため)
  async uploadObject(
    c: Context<{ Bindings: Env }>,
    input: { bucket: string; prefix: string; file: File; overwrite: boolean },
  ) {
    const bucket = resolveBucket(c.env, input.bucket);
    if (!bucket) throw new BadRequestError(`未知のバケットです: ${input.bucket}`);

    const fileName = input.file.name;
    if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
      throw new BadRequestError("ファイル名が不正です");
    }
    const prefix = input.prefix.replace(/^\/+/, "");
    if (prefix && !prefix.endsWith("/")) throw new BadRequestError("保存先フォルダの指定が不正です");
    if (prefix.split("/").some((seg) => seg === "..")) throw new BadRequestError("保存先フォルダの指定が不正です");
    if (input.file.size === 0) throw new BadRequestError("空のファイルはアップロードできません");
    if (input.file.size > R2_MAX_UPLOAD_BYTES) {
      throw new BadRequestError(`ファイルサイズが上限(${R2_MAX_UPLOAD_BYTES / 1024 / 1024}MB)を超えています`);
    }

    const key = `${prefix}${fileName}`;
    const existing = await bucket.head(key);
    if (existing && !input.overwrite) {
      throw new BadRequestError("同名のファイルが既に存在します(上書きする場合は上書きを指定してください)");
    }

    await bucket.put(key, await input.file.arrayBuffer(), {
      httpMetadata: { contentType: input.file.type || "application/octet-stream" },
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPLOAD_R2_OBJECT", RESOURCE_KEY, key, null, {
        bucket: input.bucket,
        key,
        size: input.file.size,
        overwritten: !!existing,
      }),
    );
    return { success: true, message: existing ? "ファイルを上書きしました" : "ファイルをアップロードしました", key };
  }

  async deleteObject(c: Context<{ Bindings: Env }>, body: DeleteR2ObjectPayload) {
    const bucket = resolveBucket(c.env, body.bucket);
    if (!bucket) throw new BadRequestError(`未知のバケットです: ${body.bucket}`);

    const existing = await bucket.head(body.key);
    if (!existing) {
      throw new NotFoundError("対象のファイルが見つかりません(既に削除済みの可能性があります)");
    }

    await bucket.delete(body.key);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_R2_OBJECT", RESOURCE_KEY, body.key, null, {
        bucket: body.bucket,
        key: body.key,
      }),
    );

    return { success: true, message: "ファイルを削除しました" };
  }

  // R2にネイティブなrenameは無いため、取得→新キーへ書き込み→旧キー削除の3手順で行う。
  // 途中でエラーが起きても旧キーはそのまま残る(部分適用にはなるが、データ消失は起きない設計)
  async renameObject(c: Context<{ Bindings: Env }>, body: RenameR2ObjectPayload) {
    const bucket = resolveBucket(c.env, body.bucket);
    if (!bucket) throw new BadRequestError(`未知のバケットです: ${body.bucket}`);
    if (body.oldKey === body.newKey) {
      throw new BadRequestError("変更前後のキーが同じです");
    }

    const existingNew = await bucket.head(body.newKey);
    if (existingNew) {
      throw new BadRequestError("変更後のファイル名は既に使用されています");
    }

    const source = await bucket.get(body.oldKey);
    if (!source) {
      throw new NotFoundError("対象のファイルが見つかりません(既に削除・移動済みの可能性があります)");
    }

    await bucket.put(body.newKey, source.body, {
      httpMetadata: source.httpMetadata,
      customMetadata: source.customMetadata,
    });
    await bucket.delete(body.oldKey);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RENAME_R2_OBJECT", RESOURCE_KEY, body.newKey, null, {
        bucket: body.bucket,
        oldKey: body.oldKey,
        newKey: body.newKey,
      }),
    );

    return { success: true, message: "ファイル名を変更しました" };
  }
}
