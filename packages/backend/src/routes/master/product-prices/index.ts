import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { ProductPriceService } from "./product-price.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  GetProductPricesQuerySchema,
  RegisterProductPriceSchema,
} from "./product-price.schema";

const productPricesRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new ProductPriceService(c.env.DB);
}

// 1. 一覧取得
// page/limit未指定時、または計算用(quantity指定)モード時は従来通り配列を返す(後方互換)。
// マスタ管理モードでpage/limit指定時のみ{data,pagination}形式で返す。
productPricesRouter.get(
  "/",
  describeApiRoute({
    summary: "特値マスタ一覧取得(計算モード/マスタ管理モード)",
    tags: ["product-prices"],
    query: GetProductPricesQuerySchema,
    responses: {
      200: {
        description:
          "quantity指定時は見積等からの自動計算用に配列を返す(page/limitは無視)。quantity未指定時はマスタ管理モードとなり、page/limit未指定なら配列、指定時のみ{data,pagination}形式で返す。",
      },
    },
  }),
  vValidator("query", GetProductPricesQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const rawQuery = c.req.query();
      const isCalculationMode = query.quantity !== undefined;
      const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
      if (
        isCalculationMode ||
        (rawQuery.page === undefined && rawQuery.limit === undefined)
      ) {
        const result = await service.listPrices(query, sort);
        return c.json(result);
      }
      const params = parsePaginationParams(rawQuery);
      const result = await service.listPricesPage(query, params, sort);
      return c.json(result);
    } catch (e) {
      return respondError(c, e, "システムエラーが発生しました");
    }
  },
);

// 2. 個別登録・条件変更
productPricesRouter.post(
  "/register",
  describeMutationRoute({
    summary: "特値マスタ個別登録・条件変更",
    tags: ["product-prices"],
    json: RegisterProductPriceSchema,
    successDescription: "登録・更新成功",
  }),
  vValidator("json", RegisterProductPriceSchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.registerPrice(c, body);
      return c.json(result);
    } catch (e) {
      return respondError(c, e, "システムエラーが発生しました");
    }
  },
);

// 3. 個別削除
productPricesRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "特値マスタ個別削除",
    tags: ["product-prices"],
    successDescription: "削除成功",
  }),
  async (c) => {
  const id = c.req.param("id");
  try {
    const service = getService(c);
    const result = await service.deletePrice(c, id);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "削除エラーが発生しました");
  }
});

// 4. 特値マスタ CSVダウンロード
productPricesRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "特値マスタCSVダウンロード", tags: ["product-prices"] }),
  vValidator("query", GetProductPricesQuerySchema, validationHook()),
  async (c) => {
  try {
    const query = c.req.valid("query");
    const service = getService(c);
    const csvContent = await service.exportCsv(c, query);

    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="product_prices_export.csv"`,
    });
  } catch (e) {
    return respondError(c, e, "CSVダウンロードエラーが発生しました");
  }
});

// 5. 特値マスタ CSV一括インポート
productPricesRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "特値マスタCSV一括インポート",
    tags: ["product-prices"],
    successDescription: "インポート成功",
    errors: [{ status: 400, description: "ファイル未添付" }],
  }),
  async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json({ success: false, message: "ファイルがありません" }, 400);
    }

    const service = getService(c);
    const result = await service.bulkRegisterCsv(c, file);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "インポート内部エラーが発生しました。");
  }
});

export { productPricesRouter };
