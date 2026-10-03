import { Hono } from "hono";
import * as v from "valibot";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { WarehousesRepository } from "./warehouses.repository";
import { WarehousesService } from "./warehouses.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  warehouseUpsertSchema,
  bulkRegisterSchema,
  GetWarehousesQuerySchema,
} from "./warehouses.schema";

const warehousesRouter = new Hono<{ Bindings: Env }>();

// DI（リポジトリ・サービスの初期化ヘルパー）
const getService = (c: any) => {
  const repo = new WarehousesRepository(c.env.DB);
  return new WarehousesService(repo);
};

// 1. 一覧取得 (GET /)
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
warehousesRouter.get(
  "/",
  describeListRoute({
    summary: "倉庫マスタ一覧取得",
    tags: ["warehouses"],
    query: GetWarehousesQuerySchema,
    itemDescription: "倉庫マスタ(添付ファイル・受付可能日込み)",
  }),
  vValidator("query", GetWarehousesQuerySchema, validationHook()),
  async (c) => {
  try {
    const searchParams = c.req.valid("query");
    const service = getService(c);
    const rawQuery = c.req.query();
    const sort = { sortBy: searchParams.sortBy, sortOrder: searchParams.sortOrder };
    if (rawQuery.page === undefined && rawQuery.limit === undefined) {
      const result = await service.getWarehouses(searchParams, sort);
      return c.json(result);
    }
    const params = parsePaginationParams(rawQuery);
    const result = await service.getWarehousesPage(searchParams, params, sort);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "一覧取得に失敗しました");
  }
});

// 2. 個別登録 (POST /register)
warehousesRouter.post(
  "/register",
  describeMutationRoute({
    summary: "倉庫マスタ個別登録",
    tags: ["warehouses"],
    json: warehouseUpsertSchema,
    successDescription: "登録成功",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
  try {
    const rawBody = await c.req.json();
    const parsed = v.parse(warehouseUpsertSchema, rawBody);

    const service = getService(c);
    const result = await service.registerWarehouse(c, parsed);

    return c.json({ success: true, message: "倉庫情報を登録しました", id: result?.id });
  } catch (err) {
    return respondError(c, err, "登録エラーが発生しました");
  }
});

// 3. 更新 (PUT /:id)
warehousesRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "倉庫マスタ更新",
    tags: ["warehouses"],
    json: warehouseUpsertSchema,
    successDescription: "更新成功",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
  const id = c.req.param("id");
  try {
    const rawBody = await c.req.json();
    const parsed = v.parse(warehouseUpsertSchema, { ...rawBody, id });

    const service = getService(c);
    await service.updateWarehouse(c, id, parsed);

    return c.json({ success: true, message: "倉庫情報を更新しました" });
  } catch (err) {
    return respondError(c, err, "更新に失敗しました");
  }
});

// 3.5 無効化 (POST /:id/suspend)
warehousesRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "倉庫マスタ無効化",
    tags: ["warehouses"],
    successDescription: "無効化成功",
  }),
  async (c) => {
  const id = c.req.param("id");
  try {
    const service = getService(c);
    await service.suspendWarehouse(c, id);

    return c.json({ success: true, message: "該当倉庫を無効化しました" });
  } catch (err) {
    return respondError(c, err, "無効化に失敗しました");
  }
});

// 4. 削除 (DELETE /:id)
warehousesRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "倉庫マスタ削除",
    tags: ["warehouses"],
    successDescription: "削除成功",
    errors: [
      { status: 400, description: "suspended状態でない倉庫は削除不可" },
    ],
  }),
  async (c) => {
  const id = c.req.param("id");
  try {
    const service = getService(c);
    await service.deleteWarehouse(c, id);

    return c.json({ success: true, message: "倉庫を削除しました" });
  } catch (err) {
    return respondError(c, err, "削除に失敗しました");
  }
});

// 5. CSVダウンロード
warehousesRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "倉庫マスタCSVダウンロード", tags: ["warehouses"] }),
  vValidator("query", GetWarehousesQuerySchema, validationHook()),
  async (c) => {
  try {
    const searchParams = c.req.valid("query");
    const service = getService(c);
    const csvContent = await service.generateCsv(searchParams);

    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="warehouses_export.csv"`,
    });
  } catch (err) {
    return respondError(c, err, "CSV生成エラー");
  }
});

// 6. CSVインポート
warehousesRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "倉庫マスタCSVインポート",
    tags: ["warehouses"],
    successDescription: "同期成功",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
  try {
    const rawBody = await c.req.json();
    const parsed = v.parse(bulkRegisterSchema, rawBody);

    const service = getService(c);
    const count = await service.bulkRegisterCsv(c, parsed.csvData);

    return c.json({
      success: true,
      message: `CSVから ${count} 件の倉庫データを同期(登録・更新)しました`,
    });
  } catch (err) {
    return respondError(c, err, "インポートに失敗しました");
  }
});

// 7. 画像・ファイルアップロードAPI
warehousesRouter.post(
  "/upload",
  describeApiRoute({
    summary: "倉庫マスタ添付ファイルアップロード",
    tags: ["warehouses"],
    responses: {
      200: { description: "アップロード成功" },
      400: { description: "ファイルが見つからない" },
    },
  }),
  async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json(
        { success: false, message: "ファイルが見つかりません" },
        400,
      );
    }

    const service = getService(c);
    const result = await service.uploadFile(c, file);

    return c.json({
      success: true,
      ...result,
    });
  } catch (err) {
    return respondError(c, err, "R2へのアップロードに失敗しました");
  }
});

// 8. ファイル配信・外部リンク転送API(DB経由: warehouseId + attachmentId で解決)
warehousesRouter.get(
  "/files/:warehouseId/:attachmentId",
  describeApiRoute({
    summary: "倉庫マスタ添付ファイル配信",
    tags: ["warehouses"],
    responses: {
      200: { description: "ファイル本体、または外部リンクへのリダイレクト" },
      404: { description: "ファイルが見つからない" },
    },
  }),
  async (c) => {
  try {
    const warehouseId = c.req.param("warehouseId");
    const attachmentId = c.req.param("attachmentId");
    const service = getService(c);
    const res = await service.getFile(c, warehouseId, attachmentId);

    if (!res) {
      return c.text("ファイルが見つかりません", 404);
    }

    if (res.type === "redirect") {
      return c.redirect(res.url);
    }

    return new Response(res.body, { headers: res.headers });
  } catch (err) {
    return respondError(c, err, "サーバー内部エラー");
  }
});

export { warehousesRouter };
