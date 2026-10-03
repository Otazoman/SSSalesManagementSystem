import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { DepartmentsService } from "./departments.service";
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
  GetDepartmentsQuerySchema,
  CreateDepartmentSchema,
  UpdateDepartmentSchema,
} from "./departments.schema";

export const departmentsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new DepartmentsService(c.env);
}

// 1. 部署一覧取得
departmentsRouter.get(
  "/",
  describeListRoute({
    summary: "部署マスタ一覧取得",
    tags: ["departments"],
    query: GetDepartmentsQuerySchema,
    itemDescription: "部署マスタ(親部署結合)",
  }),
  vValidator("query", GetDepartmentsQuerySchema, validationHook()),
  async (c) => {
    try {
      const { status, filter, targetDate, sortBy, sortOrder } = c.req.valid("query");

      const service = getService(c);
      const rawQuery = c.req.query();
      const sort = { sortBy, sortOrder };
      if (rawQuery.page === undefined && rawQuery.limit === undefined) {
        const mappedResults = await service.getDepartments(
          status,
          filter,
          targetDate,
          sort,
        );
        return c.json(mappedResults);
      }
      const params = parsePaginationParams(rawQuery);
      const result = await service.getDepartmentsPage(
        status,
        filter,
        targetDate,
        params,
        sort,
      );
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "部署一覧の取得に失敗しました");
    }
  },
);

// 2. 個別部署追加 (POST)
departmentsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "部署マスタ新規追加",
    tags: ["departments"],
    json: CreateDepartmentSchema,
    successDescription: "追加成功",
  }),
  vValidator("json", CreateDepartmentSchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.createDepartment(c, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "部署マスタの追加に失敗しました");
    }
  },
);

// 3. 部署の変更 (PUT)
departmentsRouter.put(
  "/:idOrSurrogate",
  describeMutationRoute({
    summary: "部署マスタ変更",
    tags: ["departments"],
    json: UpdateDepartmentSchema,
    successDescription: "変更成功",
    errors: [{ status: 400, description: "組織階層のループが検出された" }],
  }),
  vValidator("json", UpdateDepartmentSchema, validationHook()),
  async (c) => {
    const idOrSurrogate = c.req.param("idOrSurrogate");
    const body = c.req.valid("json");

    try {
      const service = getService(c);
      const result = await service.updateDepartment(c, idOrSurrogate, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "部署の変更に失敗しました");
    }
  },
);

// 4. 部署の無効化 (POST)
departmentsRouter.post(
  "/:idOrSurrogate/suspend",
  describeMutationRoute({
    summary: "部署マスタ無効化",
    tags: ["departments"],
    successDescription: "無効化成功",
  }),
  async (c) => {
  const idOrSurrogate = c.req.param("idOrSurrogate");

  try {
    const service = getService(c);
    const result = await service.suspendDepartment(c, idOrSurrogate);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "部署の無効化に失敗しました");
  }
});

// 5. 部署の復元
departmentsRouter.post(
  "/:idOrSurrogate/restore",
  describeMutationRoute({
    summary: "部署マスタ復元(無期限化)",
    tags: ["departments"],
    successDescription: "復元成功",
  }),
  async (c) => {
  const idOrSurrogate = c.req.param("idOrSurrogate");

  try {
    const service = getService(c);
    const result = await service.restoreDepartment(c, idOrSurrogate);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "部署の復元に失敗しました");
  }
});

// 6. CSVダウンロード
departmentsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "部署マスタCSVダウンロード", tags: ["departments"] }),
  vValidator("query", GetDepartmentsQuerySchema, validationHook()),
  async (c) => {
  try {
    const { status, filter, targetDate } = c.req.valid("query");

    const service = getService(c);
    const responseBody = await service.generateCsv(c, status, filter, targetDate);

    return c.body(responseBody, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="departments_export.csv"',
    });
  } catch (err) {
    return respondError(c, err, "CSV作成処理中にエラーが発生しました");
  }
});

// 7. CSV一括インポート
departmentsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "部署マスタCSV一括インポート(期間リレーション含む)",
    tags: ["departments"],
    successDescription: "同期成功",
    errors: [{ status: 400, description: "CSVファイル未添付" }],
  }),
  async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json(
        { success: false, message: "CSVファイルが添付されていません" },
        400,
      );
    }

    const service = getService(c);
    const result = await service.bulkRegister(c, file);

    return c.json(result);
  } catch (err) {
    return respondError(c, err, "CSVインポートに失敗しました");
  }
});
