import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { AuditsRepository } from "./audits.repository";
import { AuditsService } from "./audits.service";
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
  createAuditSchema,
  GetAuditsQuerySchema,
  bulkRegisterAuditSchema,
} from "./audits.schema";

const stockAuditsRouter = new Hono<{ Bindings: Env }>();

const getService = (c: any) => new AuditsService(new AuditsRepository(c.env.DB));

// 棚卸履歴一覧 (GET /)
stockAuditsRouter.get(
  "/",
  describeListRoute({
    summary: "棚卸履歴一覧取得",
    tags: ["stock-audits"],
    query: GetAuditsQuerySchema,
    itemDescription: "棚卸レコード",
  }),
  async (c) => {
    try {
      const searchParams = v.parse(GetAuditsQuerySchema, c.req.query());
      const params = parsePaginationParams(c.req.query());
      const service = getService(c);
      const sort = { sortBy: searchParams.sortBy, sortOrder: searchParams.sortOrder };
      const result = await service.listAudits(searchParams, params, sort);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "棚卸履歴一覧取得に失敗しました");
    }
  },
);

// 棚卸履歴CSVダウンロード (GET /csv-download)
stockAuditsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "棚卸履歴CSVダウンロード", tags: ["stock-audits"] }),
  async (c) => {
    try {
      const searchParams = v.parse(GetAuditsQuerySchema, c.req.query());
      const service = getService(c);
      const csvContent = await service.generateCsv(searchParams);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="stock_audits_export.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "CSV生成エラー");
    }
  },
);

// 棚卸CSV一括登録 (POST /bulk-register) : 1行=1棚卸として登録する
stockAuditsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "棚卸CSVインポート",
    tags: ["stock-audits"],
    successDescription: "登録成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(bulkRegisterAuditSchema, rawBody);

      const service = getService(c);
      const result = await service.bulkImportCsv(c, parsed.csvData);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "CSVインポートに失敗しました");
    }
  },
);

// 棚卸詳細 (GET /:id)
stockAuditsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "棚卸詳細取得",
    tags: ["stock-audits"],
    responses: {
      200: { description: "棚卸レコード" },
      404: { description: "対象の棚卸が見つからない" },
    },
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const service = getService(c);
      const result = await service.getAuditDetail(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "棚卸詳細取得に失敗しました");
    }
  },
);

// 棚卸確定 (POST /) : ロケーション×商品の実棚数量を確定し、承認機能ONなら承認申請、OFFなら即座に在庫反映する
stockAuditsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "棚卸確定",
    tags: ["stock-audits"],
    json: createAuditSchema,
    successDescription: "棚卸確定成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(createAuditSchema, rawBody);

      const service = getService(c);
      const result = await service.createAudit(c, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "棚卸確定に失敗しました");
    }
  },
);

// 修正して再提出 (PUT /:id) : 差戻し済みの棚卸を同じidのまま書き換えて再申請する
stockAuditsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "棚卸の修正・再申請",
    tags: ["stock-audits"],
    json: createAuditSchema,
    successDescription: "再申請成功(承認機能ONの場合は承認を申請)",
    errors: [
      { status: 400, description: "入力データ検証エラー、または差戻し状態以外の対象" },
      { status: 404, description: "対象の棚卸が見つからない" },
    ],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const rawBody = await c.req.json();
      const parsed = v.parse(createAuditSchema, rawBody);

      const service = getService(c);
      const result = await service.resubmitAudit(c, id, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "棚卸の修正・再申請に失敗しました");
    }
  },
);

export { stockAuditsRouter };
