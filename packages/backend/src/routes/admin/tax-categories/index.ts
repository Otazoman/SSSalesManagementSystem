import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { TaxCategoriesService } from "./tax-categories.service";
import { saveTaxCategorySchema } from "./tax-categories.schema";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import { todayJst } from "../../../platform/date/format-jst-date";

const taxCategoriesRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new TaxCategoriesService(c.env.DB);
}

// 1. 全件取得 (GET /)
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
taxCategoriesRouter.get(
  "/",
  describeListRoute({
    summary: "消費税マスタ一覧取得",
    tags: ["tax-categories"],
    itemDescription: "消費税マスタ",
  }),
  async (c) => {
  try {
    const service = getService(c);
    const query = c.req.query();
    const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
    if (query.page === undefined && query.limit === undefined) {
      const result = await service.getTaxCategories(sort);
      return c.json(result);
    }
    const params = parsePaginationParams(query);
    const result = await service.getTaxCategoriesPage(params, sort);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "消費税マスタ取得エラー");
  }
});

// 2. 新規登録・更新 (POST /)
taxCategoriesRouter.post(
  "/register",
  describeMutationRoute({
    summary: "消費税マスタ新規登録",
    tags: ["tax-categories"],
    json: saveTaxCategorySchema,
    successDescription: "保存成功",
  }),
  vValidator("json", saveTaxCategorySchema, validationHook()),
  async (c) => {
    try {
      const input = c.req.valid("json");
      const service = getService(c);
      await service.saveTaxCategory(c, input);
      return c.json({ success: true, message: "消費税区分を保存しました" });
    } catch (err) {
      return respondError(c, err, "消費税区分保存エラー");
    }
  },
);

// 3. 更新 (PUT /)
taxCategoriesRouter.put(
  "/",
  describeMutationRoute({
    summary: "消費税マスタ更新",
    tags: ["tax-categories"],
    json: saveTaxCategorySchema,
    successDescription: "更新成功",
  }),
  vValidator("json", saveTaxCategorySchema, validationHook()),
  async (c) => {
    try {
      const input = c.req.valid("json");
      const service = getService(c);
      await service.saveTaxCategory(c, input);
      return c.json({ success: true, message: "消費税区分を更新しました" });
    } catch (err) {
      return respondError(c, err, "消費税区分更新エラー");
    }
  },
);

// BUG-039: CSVダウンロード (GET /csv-download)。他のマスタと同じく、そのままCSVインポートに使える形
taxCategoriesRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "消費税マスタCSVダウンロード", tags: ["tax-categories"] }),
  async (c) => {
    try {
      const csv = await getService(c).exportCsv();
      return c.body(csv, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tax_categories_export_${todayJst()}.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "消費税マスタのCSV出力に失敗しました");
    }
  },
);

// BUG-039: CSVインポート (POST /bulk-register)。1行でも不正な行があれば何も登録せず、行番号つきで返す
taxCategoriesRouter.post(
  "/bulk-register",
  describeCsvImportRoute({ summary: "消費税マスタCSVインポート", tags: ["tax-categories"] }),
  async (c) => {
    try {
      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return c.json({ success: false, message: "CSVファイルを選択してください" }, 400);
      }
      const count = await getService(c).importCsv(c, await file.text());
      return c.json({ success: true, message: `CSVから ${count} 件の消費税区分を登録・更新しました` });
    } catch (err) {
      return respondError(c, err, "消費税マスタのCSVインポートに失敗しました");
    }
  },
);

// 4. 削除 (DELETE /:code)
taxCategoriesRouter.delete(
  "/:code",
  describeDeleteRoute({
    summary: "消費税マスタ削除",
    tags: ["tax-categories"],
    successDescription: "削除成功",
    errors: [
      { status: 400, description: "品目マスタから参照されているため削除不可" },
    ],
  }),
  async (c) => {
  const code = c.req.param("code");
  try {
    const service = getService(c);
    await service.deleteTaxCategory(c, code);
    return c.json({ success: true, message: "消費税区分を削除しました" });
  } catch (err) {
    return respondError(c, err, "消費税区分削除エラー");
  }
});

export { taxCategoriesRouter };
