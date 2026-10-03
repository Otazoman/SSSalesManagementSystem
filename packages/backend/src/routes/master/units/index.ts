import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { UnitsService } from "./units.service";
import { createUnitSchema, updateUnitSchema } from "./units.schema";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";

const unitsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new UnitsService(c.env.DB);
}

// 1. 一覧取得 (GET /)
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
unitsRouter.get(
  "/",
  describeListRoute({
    summary: "単位マスタ一覧取得",
    tags: ["units"],
    itemDescription: "単位マスタ",
  }),
  async (c) => {
  try {
    const service = getService(c);
    const query = c.req.query();
    const status = query.status || undefined;
    const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
    if (query.page === undefined && query.limit === undefined) {
      const result = await service.getAllUnits(status, sort);
      return c.json(result);
    }
    const params = parsePaginationParams(query);
    const result = await service.getUnitsPage(params, status, sort);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "単位一覧の取得に失敗しました");
  }
});

// 2. 新規登録 (POST /register)
unitsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "単位マスタ新規登録",
    tags: ["units"],
    json: createUnitSchema,
    successDescription: "登録成功",
    errors: [{ status: 400, description: "重複した単位コード、または不正な入力" }],
  }),
  vValidator("json", createUnitSchema, validationHook()),
  async (c) => {
    try {
      const input = c.req.valid("json");
      const service = getService(c);
      const result = await service.registerUnit(c, input);
      return c.json({
        success: true,
        message: "単位を登録しました",
        status: result.status,
      });
    } catch (err) {
      return respondError(c, err, "登録処理で内部エラーが発生しました");
    }
  },
);

// 3. 削除 (DELETE /:code)
unitsRouter.delete(
  "/:code",
  describeDeleteRoute({
    summary: "単位マスタ削除",
    tags: ["units"],
    successDescription: "削除成功",
    errors: [{ status: 400, description: "他マスタから参照されているため削除不可" }],
  }),
  async (c) => {
  const code = c.req.param("code");
  try {
    const service = getService(c);
    await service.deleteUnit(c, code);
    return c.json({ success: true, message: "単位を削除しました" });
  } catch (err) {
    return respondError(c, err, "削除失敗");
  }
});

// 4. 更新 (PUT /:code)
unitsRouter.put(
  "/:code",
  describeMutationRoute({
    summary: "単位マスタ更新",
    tags: ["units"],
    json: updateUnitSchema,
    successDescription: "更新成功",
    errors: [{ status: 404, description: "対象の単位が見つからない" }],
  }),
  vValidator("json", updateUnitSchema, validationHook()),
  async (c) => {
  const code = c.req.param("code").toUpperCase().trim();
  try {
    const input = c.req.valid("json");
    const service = getService(c);
    await service.updateUnit(c, code, input);
    return c.json({ success: true, message: "単位を更新しました" });
  } catch (err) {
    return respondError(c, err, "更新失敗、または不正な入力です");
  }
});

// 4.5 無効化 (POST /:code/suspend)
unitsRouter.post(
  "/:code/suspend",
  describeMutationRoute({
    summary: "単位マスタ無効化",
    tags: ["units"],
    successDescription: "無効化成功",
    errors: [{ status: 404, description: "対象の単位が見つからない" }],
  }),
  async (c) => {
  const code = c.req.param("code");
  try {
    const service = getService(c);
    await service.suspendUnit(c, code);
    return c.json({ success: true, message: "単位を無効化しました" });
  } catch (err) {
    return respondError(c, err, "無効化に失敗しました");
  }
});

// 5. CSVダウンロード (GET /csv/download)
unitsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({
    summary: "単位マスタCSVダウンロード",
    tags: ["units"],
  }),
  async (c) => {
  try {
    const service = getService(c);
    const csvContent = await service.exportCsv();
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="units_export_${Date.now()}.csv"`,
    });
  } catch (err) {
    return respondError(c, err, "CSV生成エラー");
  }
});

// 6. CSVインポート (POST /csv/import)
unitsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "単位マスタCSVインポート",
    tags: ["units"],
    successDescription: "インポート成功",
    errors: [{ status: 400, description: "ファイル未添付などの入力エラー" }],
  }),
  async (c) => {
  try {
    const service = getService(c);
    const successCount = await service.importCsv(c);

    if (successCount === 0) {
      return c.json({
        success: true,
        message: "同期する有効なデータがありませんでした",
      });
    }

    return c.json({
      success: true,
      message: `CSVから ${successCount} 件の単位データを安全に同期しました`,
    });
  } catch (err) {
    return respondError(c, err, "インポートに失敗しました");
  }
});

export { unitsRouter };
