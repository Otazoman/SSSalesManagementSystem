import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { DisposalsRepository } from "./disposals.repository";
import { DisposalsService } from "./disposals.service";
import { respondError } from "../../../platform/http/error-handler";
import {
  describeMutationRoute,
  describeListRoute,
  describeApiRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  createDisposalSchema,
  GetDisposalsQuerySchema,
  bulkRegisterDisposalSchema,
} from "./disposals.schema";

const stockDisposalsRouter = new Hono<{ Bindings: Env }>();

const getService = (c: any) =>
  new DisposalsService(new DisposalsRepository(c.env.DB));

// 廃棄履歴一覧 (GET /)
stockDisposalsRouter.get(
  "/",
  describeListRoute({
    summary: "廃棄履歴一覧取得",
    tags: ["stock-disposals"],
    query: GetDisposalsQuerySchema,
    itemDescription: "廃棄レコード",
  }),
  async (c) => {
    try {
      const searchParams = v.parse(GetDisposalsQuerySchema, c.req.query());
      const params = parsePaginationParams(c.req.query());
      const service = getService(c);
      const sort = { sortBy: searchParams.sortBy, sortOrder: searchParams.sortOrder };
      const result = await service.listDisposals(searchParams, params, sort);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "廃棄履歴一覧取得に失敗しました");
    }
  },
);

// 廃棄履歴CSVダウンロード (GET /csv-download)
stockDisposalsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "廃棄履歴CSVダウンロード", tags: ["stock-disposals"] }),
  async (c) => {
    try {
      const searchParams = v.parse(GetDisposalsQuerySchema, c.req.query());
      const service = getService(c);
      const csvContent = await service.generateCsv(searchParams);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="stock_disposals_export.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "CSV生成エラー");
    }
  },
);

// 廃棄CSV一括登録 (POST /bulk-register) : 1行=1廃棄として登録する
stockDisposalsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "廃棄CSVインポート",
    tags: ["stock-disposals"],
    successDescription: "登録成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(bulkRegisterDisposalSchema, rawBody);

      const service = getService(c);
      const result = await service.bulkImportCsv(c, parsed.csvData);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "CSVインポートに失敗しました");
    }
  },
);

// 廃棄詳細 (GET /:id)
stockDisposalsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "廃棄詳細取得",
    tags: ["stock-disposals"],
    responses: {
      200: { description: "廃棄レコード" },
      404: { description: "対象の廃棄が見つからない" },
    },
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const service = getService(c);
      const result = await service.getDetail(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "廃棄詳細取得に失敗しました");
    }
  },
);

// 廃棄確定 (POST /) : 対象在庫を減算する。承認機能ON(is_disposal_approval_enabled)なら承認申請、
// OFFなら即座に在庫反映する
stockDisposalsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "在庫の廃棄決定",
    tags: ["stock-disposals"],
    json: createDisposalSchema,
    successDescription: "廃棄成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(createDisposalSchema, rawBody);

      const service = getService(c);
      const result = await service.createDisposal(c, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "廃棄に失敗しました");
    }
  },
);

// 修正して再提出 (PUT /:id) : 差戻し済みの廃棄を同じidのまま書き換えて再申請する
stockDisposalsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "廃棄の修正・再申請",
    tags: ["stock-disposals"],
    json: createDisposalSchema,
    successDescription: "再申請成功(承認機能ONの場合は承認を申請)",
    errors: [
      { status: 400, description: "入力データ検証エラー、または差戻し状態以外の対象" },
      { status: 404, description: "対象の廃棄が見つからない" },
    ],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const rawBody = await c.req.json();
      const parsed = v.parse(createDisposalSchema, rawBody);

      const service = getService(c);
      const result = await service.resubmitDisposal(c, id, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "廃棄の修正・再申請に失敗しました");
    }
  },
);

export { stockDisposalsRouter };
