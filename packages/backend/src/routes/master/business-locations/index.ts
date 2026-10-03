import { Hono } from "hono";
import * as v from "valibot";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { BusinessLocationsRepository } from "./business-locations.repository";
import { BusinessLocationsService } from "./business-locations.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  businessLocationUpsertSchema,
  bulkRegisterSchema,
  GetBusinessLocationsQuerySchema,
} from "./business-locations.schema";

const businessLocationsRouter = new Hono<{ Bindings: Env }>();

// DI(リポジトリ・サービスの初期化ヘルパー)
const getService = (c: any) => {
  const repo = new BusinessLocationsRepository(c.env.DB);
  return new BusinessLocationsService(repo);
};

// 1. 一覧取得 (GET /)
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
businessLocationsRouter.get(
  "/",
  describeListRoute({
    summary: "営業拠点マスタ一覧取得",
    tags: ["business-locations"],
    query: GetBusinessLocationsQuerySchema,
    itemDescription: "営業拠点マスタ",
  }),
  vValidator("query", GetBusinessLocationsQuerySchema, validationHook()),
  async (c) => {
    try {
      const searchParams = c.req.valid("query");
      const service = getService(c);
      const rawQuery = c.req.query();
      const sort = { sortBy: searchParams.sortBy, sortOrder: searchParams.sortOrder };
      if (rawQuery.page === undefined && rawQuery.limit === undefined) {
        const result = await service.getBusinessLocations(searchParams, sort);
        return c.json(result);
      }
      const params = parsePaginationParams(rawQuery);
      const result = await service.getBusinessLocationsPage(searchParams, params, sort);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "一覧取得に失敗しました");
    }
  },
);

// 2. 個別登録 (POST /register)
businessLocationsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "営業拠点マスタ個別登録",
    tags: ["business-locations"],
    json: businessLocationUpsertSchema,
    successDescription: "登録成功",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(businessLocationUpsertSchema, rawBody);

      const service = getService(c);
      const result = await service.registerBusinessLocation(c, parsed);

      return c.json({ success: true, message: "営業拠点情報を登録しました", id: result?.id });
    } catch (err) {
      return respondError(c, err, "登録エラーが発生しました");
    }
  },
);

// 3. 更新 (PUT /:id)
businessLocationsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "営業拠点マスタ更新",
    tags: ["business-locations"],
    json: businessLocationUpsertSchema,
    successDescription: "更新成功",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    const id = c.req.param("id");
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(businessLocationUpsertSchema, { ...rawBody, id });

      const service = getService(c);
      await service.updateBusinessLocation(c, id, parsed);

      return c.json({ success: true, message: "営業拠点情報を更新しました" });
    } catch (err) {
      return respondError(c, err, "更新に失敗しました");
    }
  },
);

// 3.5 無効化 (POST /:id/suspend)
businessLocationsRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "営業拠点マスタ無効化",
    tags: ["business-locations"],
    successDescription: "無効化成功",
  }),
  async (c) => {
    const id = c.req.param("id");
    try {
      const service = getService(c);
      await service.suspendBusinessLocation(c, id);

      return c.json({ success: true, message: "該当営業拠点を無効化しました" });
    } catch (err) {
      return respondError(c, err, "無効化に失敗しました");
    }
  },
);

// 4. 削除 (DELETE /:id)
businessLocationsRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "営業拠点マスタ削除",
    tags: ["business-locations"],
    successDescription: "削除成功",
    errors: [{ status: 400, description: "suspended状態でない営業拠点は削除不可" }],
  }),
  async (c) => {
    const id = c.req.param("id");
    try {
      const service = getService(c);
      await service.deleteBusinessLocation(c, id);

      return c.json({ success: true, message: "営業拠点を削除しました" });
    } catch (err) {
      return respondError(c, err, "削除に失敗しました");
    }
  },
);

// 5. CSVダウンロード
businessLocationsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "営業拠点マスタCSVダウンロード", tags: ["business-locations"] }),
  vValidator("query", GetBusinessLocationsQuerySchema, validationHook()),
  async (c) => {
    try {
      const searchParams = c.req.valid("query");
      const service = getService(c);
      const csvContent = await service.generateCsv(searchParams);

      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="business_locations_export.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "CSV生成エラー");
    }
  },
);

// 6. CSVインポート
businessLocationsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "営業拠点マスタCSVインポート",
    tags: ["business-locations"],
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
        message: `CSVから ${count} 件の営業拠点データを同期(登録・更新)しました`,
      });
    } catch (err) {
      return respondError(c, err, "インポートに失敗しました");
    }
  },
);

export { businessLocationsRouter };
