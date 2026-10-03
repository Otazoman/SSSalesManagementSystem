import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { PermissionsService } from "./permissions.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeListRoute,
  describeMutationRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  bulkCreatePermissionsSchema,
  getRolePermissionsParamSchema,
  updateRolePermissionsSchema,
} from "./permissions.schema";

const permissionsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new PermissionsService(c.env);
}

// 1. 共通マスタ定義の全画面データを取得
permissionsRouter.get(
  "/screens",
  describeApiRoute({
    summary: "画面マスタ定義取得",
    tags: ["permissions"],
    responses: { 200: { description: "画面マスタ定義一覧" } },
  }),
  (c) => {
  const service = getService(c);
  return c.json(service.getScreenMaster());
});

// 2. 機能権限マスタ一覧の取得
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
permissionsRouter.get(
  "/",
  describeListRoute({
    summary: "機能権限マスタ一覧取得",
    tags: ["permissions"],
    itemDescription: "機能権限マスタ",
  }),
  async (c) => {
  const service = getService(c);
  const query = c.req.query();
  if (query.page === undefined && query.limit === undefined) {
    const result = await service.getAllPermissions();
    return c.json(result);
  }
  const params = parsePaginationParams(query);
  const result = await service.getPermissionsPage(params);
  return c.json(result);
});

// 3. 基本権限の一括自動生成 (POST /bulk)
permissionsRouter.post(
  "/bulk",
  describeMutationRoute({
    summary: "基本権限の一括自動生成",
    tags: ["permissions"],
    json: bulkCreatePermissionsSchema,
    successDescription: "生成成功",
    errors: [{ status: 400, description: "データ形式が不正" }],
  }),
  vValidator("json", bulkCreatePermissionsSchema, validationHook("一括自動生成のデータ形式が不正です")),
  async (c) => {
    try {
      const { items } = c.req.valid("json");
      const service = getService(c);
      const result = await service.bulkCreatePermissions(c, items);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "権限の一括自動生成に失敗しました");
    }
  },
);

// 4. ロールに紐づく機能権限IDの一覧取得
permissionsRouter.get(
  "/role/:roleId",
  describeApiRoute({
    summary: "ロール別機能権限ID一覧取得",
    tags: ["permissions"],
    responses: {
      200: { description: "権限ID文字列の配列" },
      400: { description: "ロールIDが指定されていない" },
    },
  }),
  vValidator("param", getRolePermissionsParamSchema, validationHook("ロールIDが指定されていません")),
  async (c) => {
    try {
      const { roleId } = c.req.valid("param");
      const service = getService(c);
      const permissionIds = await service.getPermissionsByRoleId(c, roleId);
      return c.json(permissionIds);
    } catch (err) {
      return respondError(c, err, "権限一覧の取得に失敗しました");
    }
  },
);

// 5. ロールへの機能権限紐づけの上書き更新 (PUT)
permissionsRouter.put(
  "/role/:roleId",
  describeMutationRoute({
    summary: "ロール別機能権限の上書き更新",
    tags: ["permissions"],
    json: updateRolePermissionsSchema,
    successDescription: "更新成功",
    errors: [{ status: 400, description: "ロールIDが指定されていない、またはデータ形式が不正" }],
  }),
  vValidator("param", getRolePermissionsParamSchema, validationHook("ロールIDが指定されていません")),
  vValidator("json", updateRolePermissionsSchema, validationHook()),
  async (c) => {
    try {
      const { roleId } = c.req.valid("param");
      const { permissionIds } = c.req.valid("json");
      const service = getService(c);
      const result = await service.updateRolePermissions(
        c,
        roleId,
        permissionIds,
      );
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "権限更新に失敗しました");
    }
  },
);

// 6. CSVダウンロード
permissionsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({
    summary: "ロール権限マトリクスCSVダウンロード",
    tags: ["permissions"],
  }),
  async (c) => {
  try {
    const service = getService(c);
    const responseBody = await service.generateCsv(c);

    return c.body(responseBody, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="role_permissions_export.csv"',
    });
  } catch (err) {
    return respondError(c, err, "CSV作成処理中にエラーが発生しました");
  }
});

// 7. CSVインポート
permissionsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "ロール権限マトリクスCSVインポート",
    tags: ["permissions"],
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
    return respondError(c, err, "インポート処理に失敗しました");
  }
});

export { permissionsRouter };
