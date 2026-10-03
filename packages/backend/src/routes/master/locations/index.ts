import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { LocationsRepository } from "./locations.repository";
import { LocationsService } from "./locations.service";
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
  GetLocationsQuerySchema,
  RegisterLocationBodySchema,
  UpdateLocationBodySchema,
  IdParamSchema,
} from "./locations.schema";

const locationsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  const repo = new LocationsRepository(c.env.DB);
  return new LocationsService(repo);
}

// 1. 一覧取得
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
locationsRouter.get(
  "/",
  describeListRoute({
    summary: "ロケーションマスタ一覧取得",
    tags: ["locations"],
    query: GetLocationsQuerySchema,
    itemDescription: "ロケーションマスタ",
  }),
  vValidator("query", GetLocationsQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const rawQuery = c.req.query();
      const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
      if (rawQuery.page === undefined && rawQuery.limit === undefined) {
        const result = await service.getLocations(query, sort);
        return c.json(result);
      }
      const params = parsePaginationParams(rawQuery);
      const result = await service.getLocationsPage(query, params, sort);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 2. 個別登録 (POST)
locationsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "ロケーションマスタ個別登録",
    tags: ["locations"],
    json: RegisterLocationBodySchema,
    successDescription: "登録成功",
  }),
  vValidator("json", RegisterLocationBodySchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.registerLocation(c, body);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 3. 更新 (PUT)
locationsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "ロケーションマスタ更新",
    tags: ["locations"],
    json: UpdateLocationBodySchema,
    successDescription: "更新成功",
  }),
  vValidator("param", IdParamSchema, validationHook()),
  vValidator("json", UpdateLocationBodySchema, validationHook()),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.updateLocation(c, id, body);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 3.5 無効化 (POST /:id/suspend)
locationsRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "ロケーションマスタ無効化",
    tags: ["locations"],
    successDescription: "無効化成功",
  }),
  vValidator("param", IdParamSchema, validationHook()),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const service = getService(c);
      const result = await service.suspendLocation(c, id);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 4. 削除 (DELETE)
locationsRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "ロケーションマスタ削除",
    tags: ["locations"],
    successDescription: "削除成功",
  }),
  vValidator("param", IdParamSchema, validationHook()),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const service = getService(c);
      const result = await service.deleteLocation(c, id);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 5. CSVダウンロード (GET)
locationsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "ロケーションマスタCSVダウンロード", tags: ["locations"] }),
  vValidator("query", GetLocationsQuerySchema, validationHook()),
  async (c) => {
  try {
    const query = c.req.valid("query");
    const service = getService(c);
    const csvContent = await service.downloadCsv(c, query);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="locations_export.csv"`,
    });
  } catch (e) {
    return respondError(c, e);
  }
});

// 6. CSVインポート (POST)
locationsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "ロケーションマスタCSVインポート",
    tags: ["locations"],
    successDescription: "同期成功",
    errors: [{ status: 400, description: "ファイル未添付" }],
  }),
  async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json({ success: false, message: "ファイルがありません" }, 400);
    }

    const text = await file.text();
    const service = getService(c);
    const result = await service.bulkRegisterCsv(c, text);
    return c.json(result);
  } catch (e) {
    return respondError(c, e);
  }
});

export { locationsRouter };
