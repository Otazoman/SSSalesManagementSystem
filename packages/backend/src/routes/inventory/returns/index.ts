import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { ReturnsRepository } from "./returns.repository";
import { ReturnsService } from "./returns.service";
import { respondError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeMutationRoute,
  describeListRoute,
  describeApiRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  createReturnSchema,
  GetReturnsQuerySchema,
  bulkRegisterReturnSchema,
} from "./returns.schema";

const stockReturnsRouter = new Hono<{ Bindings: Env }>();

const getService = (c: any) => new ReturnsService(new ReturnsRepository(c.env.DB));

// 返品履歴一覧 (GET /)
stockReturnsRouter.get(
  "/",
  describeListRoute({
    summary: "返品履歴一覧取得",
    tags: ["stock-returns"],
    query: GetReturnsQuerySchema,
    itemDescription: "返品レコード",
  }),
  async (c) => {
    try {
      const searchParams = v.parse(GetReturnsQuerySchema, c.req.query());
      const params = parsePaginationParams(c.req.query());
      const service = getService(c);
      const sort = { sortBy: searchParams.sortBy, sortOrder: searchParams.sortOrder };
      const result = await service.listReturns(searchParams, params, sort);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "返品履歴一覧取得に失敗しました");
    }
  },
);

// 返品履歴CSVダウンロード (GET /csv-download)
stockReturnsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "返品履歴CSVダウンロード", tags: ["stock-returns"] }),
  async (c) => {
    try {
      const searchParams = v.parse(GetReturnsQuerySchema, c.req.query());
      const service = getService(c);
      const csvContent = await service.generateCsv(searchParams);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="stock_returns_export.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "CSV生成エラー");
    }
  },
);

// 返品CSV一括登録 (POST /bulk-register) : 1行=1返品として登録する
stockReturnsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "返品CSVインポート",
    tags: ["stock-returns"],
    successDescription: "登録成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(bulkRegisterReturnSchema, rawBody);

      const service = getService(c);
      const result = await service.bulkImportCsv(c, parsed.csvData);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "CSVインポートに失敗しました");
    }
  },
);

// 返品詳細 (GET /:id)
stockReturnsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "返品詳細取得",
    tags: ["stock-returns"],
    responses: {
      200: { description: "返品レコード" },
      404: { description: "対象の返品が見つからない" },
    },
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const service = getService(c);
      const result = await service.getDetail(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "返品詳細取得に失敗しました");
    }
  },
);

// 返品確定 (POST /) : 仕入先へ返品(在庫減少)/得意先から返品(在庫増加)を記録する。
// 承認機能ON(is_return_approval_enabled)なら承認申請、OFFなら即座に在庫反映する
stockReturnsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "在庫の返品登録",
    tags: ["stock-returns"],
    json: createReturnSchema,
    successDescription: "返品成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(createReturnSchema, rawBody);

      const service = getService(c);
      const result = await service.createReturn(c, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "返品に失敗しました");
    }
  },
);

// 修正して再提出 (PUT /:id) : 差戻し済みの返品を同じidのまま書き換えて再申請する
stockReturnsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "返品の修正・再申請",
    tags: ["stock-returns"],
    json: createReturnSchema,
    successDescription: "再申請成功(承認機能ONの場合は承認を申請)",
    errors: [
      { status: 400, description: "入力データ検証エラー、または差戻し状態以外の対象" },
      { status: 404, description: "対象の返品が見つからない" },
    ],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const rawBody = await c.req.json();
      const parsed = v.parse(createReturnSchema, rawBody);

      const service = getService(c);
      const result = await service.resubmitReturn(c, id, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "返品の修正・再申請に失敗しました");
    }
  },
);

export { stockReturnsRouter };
