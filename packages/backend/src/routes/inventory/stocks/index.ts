import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { StockRepository } from "./stocks.repository";
import { StocksService } from "./stocks.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { describeListRoute, describeCsvDownloadRoute } from "../../../platform/openapi/describe-route";
import { parsePaginationParams } from "../../../platform/http/pagination";
import { GetStocksQuerySchema } from "./stocks.schema";

const stocksRouter = new Hono<{ Bindings: Env }>();

// 現在庫一覧取得 (GET /)
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
stocksRouter.get(
  "/",
  describeListRoute({
    summary: "在庫現在高一覧取得",
    tags: ["stocks"],
    query: GetStocksQuerySchema,
    itemDescription: "在庫現在高(品目名・倉庫名・ロケーション名込み)",
  }),
  vValidator("query", GetStocksQuerySchema, validationHook()),
  async (c) => {
    try {
      const searchParams = c.req.valid("query");
      const service = new StocksService(new StockRepository(c.env.DB));
      const rawQuery = c.req.query();
      const sort = { sortBy: searchParams.sortBy, sortOrder: searchParams.sortOrder };
      if (rawQuery.page === undefined && rawQuery.limit === undefined) {
        const result = await service.getStocks(searchParams, sort);
        return c.json(result);
      }
      const params = parsePaginationParams(rawQuery);
      const result = await service.getStocksPage(searchParams, params, sort);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "在庫一覧取得に失敗しました");
    }
  },
);

// 在庫表CSVダウンロード (GET /csv-download) : 一覧取得と同じ検索条件を使い回す
stocksRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "在庫表CSVダウンロード", tags: ["stocks"] }),
  vValidator("query", GetStocksQuerySchema, validationHook()),
  async (c) => {
    try {
      const searchParams = c.req.valid("query");
      const service = new StocksService(new StockRepository(c.env.DB));
      const csvContent = await service.generateCsv(searchParams);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="stocks_export.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "CSV生成エラー");
    }
  },
);

export { stocksRouter };
