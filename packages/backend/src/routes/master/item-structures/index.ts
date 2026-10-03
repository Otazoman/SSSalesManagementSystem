import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { ItemStructuresRepository } from "./item-structures.repository";
import { ItemStructuresService } from "./item-structures.service";
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
  GetItemStructuresQuerySchema,
  RegisterItemStructureBodySchema,
  IdParamSchema,
} from "./item-structures.schema";

const itemStructuresRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  const repo = new ItemStructuresRepository(c.env.DB);
  return new ItemStructuresService(repo);
}

// 1. 検索 & 一覧取得
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
itemStructuresRouter.get(
  "/",
  describeListRoute({
    summary: "品目構成(BOM)一覧・検索",
    tags: ["item-structures"],
    query: GetItemStructuresQuerySchema,
    itemDescription: "品目構成(親子品目・単価結合)",
  }),
  vValidator("query", GetItemStructuresQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const rawQuery = c.req.query();
      const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
      if (rawQuery.page === undefined && rawQuery.limit === undefined) {
        const result = await service.getItemStructures(query, sort);
        return c.json(result);
      }
      const params = parsePaginationParams(rawQuery);
      const result = await service.getItemStructuresPage(query, params, sort);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 2. 個別登録・更新
itemStructuresRouter.post(
  "/register",
  describeMutationRoute({
    summary: "品目構成(BOM)個別登録・更新",
    tags: ["item-structures"],
    json: RegisterItemStructureBodySchema,
    successDescription: "登録・更新成功",
    errors: [
      { status: 400, description: "自分自身を構成部品にできない、子部品が存在しない、または取引停止中" },
    ],
  }),
  vValidator("json", RegisterItemStructureBodySchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.registerItemStructure(c, body);

      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 3. 個別削除
itemStructuresRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "品目構成(BOM)個別削除",
    tags: ["item-structures"],
    successDescription: "削除成功",
  }),
  vValidator("param", IdParamSchema, validationHook()),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const service = getService(c);
      const result = await service.deleteItemStructure(c, id);

      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 3.5 無効化 (POST /:id/suspend)
itemStructuresRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "品目構成(BOM)無効化",
    tags: ["item-structures"],
    successDescription: "無効化成功",
  }),
  vValidator("param", IdParamSchema, validationHook()),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const service = getService(c);
      const result = await service.suspendItemStructure(c, id);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 4. CSVエクスポート
itemStructuresRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "品目構成(BOM)CSVダウンロード", tags: ["item-structures"] }),
  vValidator("query", GetItemStructuresQuerySchema, validationHook()),
  async (c) => {
  try {
    const query = c.req.valid("query");
    const service = getService(c);
    const csvContent = await service.downloadCsv(c, query);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products_bom_cost_export.csv"`,
    });
  } catch (e) {
    return respondError(c, e);
  }
});

// 5. CSVインポート
itemStructuresRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "品目構成(BOM)CSVインポート",
    tags: ["item-structures"],
    successDescription: "同期成功",
    errors: [{ status: 400, description: "ファイル未添付" }],
  }),
  async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json(
        { success: false, message: "ファイルが添付されていません" },
        400,
      );
    }

    const text = await file.text();
    const service = getService(c);
    const result = await service.bulkRegisterCsv(c, text);

    return c.json(result);
  } catch (e) {
    return respondError(c, e);
  }
});

// 6. アクティブな親品目一覧取得
itemStructuresRouter.get(
  "/active-parents",
  describeApiRoute({
    summary: "アクティブな親品目一覧取得",
    tags: ["item-structures"],
    responses: { 200: { description: "親品目として使用されている品目の一覧" } },
  }),
  async (c) => {
  try {
    const service = getService(c);
    const result = await service.getActiveParents();
    return c.json(result);
  } catch (e) {
    return respondError(c, e);
  }
});

export { itemStructuresRouter };
