import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { RolesService } from "./roles.service";
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
  createRoleSchema,
  updateRoleSchema,
  roleParamSchema,
} from "./roles.schema";

const rolesRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new RolesService(c.env);
}

// 1. ロール一覧取得
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
rolesRouter.get(
  "/",
  describeListRoute({
    summary: "ロールマスタ一覧取得",
    tags: ["roles"],
    itemDescription: "ロールマスタ",
  }),
  async (c) => {
  const service = getService(c);
  const query = c.req.query();
  const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
  if (query.page === undefined && query.limit === undefined) {
    const result = await service.getAllRoles(sort);
    return c.json(result);
  }
  const params = parsePaginationParams(query);
  const result = await service.getRolesPage(params, sort);
  return c.json(result);
});

// 2. ロールの新規作成 (POST)
rolesRouter.post(
  "/register",
  describeMutationRoute({
    summary: "ロールマスタ新規登録",
    tags: ["roles"],
    json: createRoleSchema,
    successDescription: "作成成功",
  }),
  vValidator("json", createRoleSchema, validationHook()),
  async (c) => {
    const validatedBody = c.req.valid("json");

    try {
      const service = getService(c);
      const result = await service.createRole(c, validatedBody);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "ロールの登録に失敗しました");
    }
  },
);

// 3. ロール変更 (PUT)
rolesRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "ロールマスタ更新",
    tags: ["roles"],
    json: updateRoleSchema,
    successDescription: "更新成功",
    errors: [{ status: 400, description: "無効なIDフォーマット、または入力不備" }],
  }),
  vValidator("param", roleParamSchema, validationHook("無効なIDフォーマットです")),
  vValidator("json", updateRoleSchema, validationHook()),
  async (c) => {
    const { id } = c.req.valid("param");
    const validatedBody = c.req.valid("json");

    try {
      const service = getService(c);
      const result = await service.updateRole(c, id, validatedBody);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "ロール情報の更新に失敗しました");
    }
  },
);

// 4. ロールの削除 (DELETE)
rolesRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "ロールマスタ削除",
    tags: ["roles"],
    successDescription: "削除成功",
    errors: [
      { status: 400, description: "無効なIDフォーマット、または他マスタから参照されているため削除不可" },
    ],
  }),
  vValidator("param", roleParamSchema, validationHook("無効なIDフォーマットです")),
  async (c) => {
    const { id } = c.req.valid("param");

    try {
      const service = getService(c);
      const result = await service.deleteRole(c, id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "ロールの削除に失敗しました");
    }
  },
);

// 5. CSVダウンロード
rolesRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "ロールマスタCSVダウンロード", tags: ["roles"] }),
  async (c) => {
  try {
    const service = getService(c);
    const responseBody = await service.generateCsv(c);

    return c.body(responseBody, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="roles_export.csv"',
    });
  } catch (err) {
    return respondError(c, err, "CSV作成処理中にエラーが発生しました");
  }
});

// 6. CSVインポート
rolesRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "ロールマスタCSVインポート",
    tags: ["roles"],
    successDescription: "インポート成功",
    errors: [{ status: 400, description: "ファイル未添付などの入力エラー" }],
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
    const result = await service.importCsv(c, file);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "ロールのインポートに失敗しました");
  }
});

export { rolesRouter };
