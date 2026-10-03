import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { ProjectsRepository } from "./projects.repository";
import { ProjectsService } from "./projects.service";
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
  GetProjectsQuerySchema,
  RegisterProjectBodySchema,
  UpdateProjectBodySchema,
  IdParamSchema,
} from "./projects.schema";

const projectsRouter = new Hono<{ Bindings: Env }>();

function getService(c: any) {
  const repo = new ProjectsRepository(c.env.DB);
  return new ProjectsService(repo);
}

// 1. 一覧取得
projectsRouter.get(
  "/",
  describeListRoute({
    summary: "プロジェクトマスタ一覧取得",
    tags: ["projects"],
    query: GetProjectsQuerySchema,
    itemDescription: "プロジェクトマスタ",
  }),
  vValidator("query", GetProjectsQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const rawQuery = c.req.query();
      const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
      if (rawQuery.page === undefined && rawQuery.limit === undefined) {
        const result = await service.getProjects(query, sort);
        return c.json(result);
      }
      const params = parsePaginationParams(rawQuery);
      const result = await service.getProjectsPage(query, params, sort);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 2. 個別登録
projectsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "プロジェクトマスタ個別登録",
    tags: ["projects"],
    json: RegisterProjectBodySchema,
    successDescription: "登録成功",
  }),
  vValidator("json", RegisterProjectBodySchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.registerProject(c, body);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 3. 更新
projectsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "プロジェクトマスタ更新",
    tags: ["projects"],
    json: UpdateProjectBodySchema,
    successDescription: "更新成功",
  }),
  vValidator("param", IdParamSchema, validationHook()),
  vValidator("json", UpdateProjectBodySchema, validationHook()),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.updateProject(c, id, body);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 4. 無効化
projectsRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "プロジェクトマスタ無効化",
    tags: ["projects"],
    successDescription: "無効化成功",
  }),
  vValidator("param", IdParamSchema, validationHook()),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const service = getService(c);
      const result = await service.suspendProject(c, id);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 5. 削除
projectsRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "プロジェクトマスタ削除",
    tags: ["projects"],
    successDescription: "削除成功",
  }),
  vValidator("param", IdParamSchema, validationHook()),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const service = getService(c);
      const result = await service.deleteProject(c, id);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 6. CSVダウンロード
projectsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "プロジェクトマスタCSVダウンロード", tags: ["projects"] }),
  vValidator("query", GetProjectsQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const csvContent = await service.downloadCsv(c, query);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="projects_export.csv"`,
      });
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 7. CSVインポート
projectsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "プロジェクトマスタCSVインポート",
    tags: ["projects"],
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
  },
);

export { projectsRouter };
