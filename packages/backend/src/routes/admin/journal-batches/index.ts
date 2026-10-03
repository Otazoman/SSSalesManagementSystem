import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { JournalBatchesRepository } from "./journal-batches.repository";
import { JournalBatchesService } from "./journal-batches.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import { describeListRoute, describeApiRoute, describeMutationRoute } from "../../../platform/openapi/describe-route";
import { SearchJournalBatchQuerySchema, CorrectJournalBatchPayloadSchema } from "./journal-batches.schema";

const journalBatchesRouter = new Hono<{ Bindings: Env }>();

journalBatchesRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): JournalBatchesService =>
  new JournalBatchesService(new JournalBatchesRepository(c.env.DB, c.env.DB_JOURNAL));

// ==========================================
// K-6-3: 仕訳バッチ一覧(検索・ページング)
// ==========================================
journalBatchesRouter.get(
  "/",
  describeListRoute({
    summary: "仕訳バッチ一覧検索",
    tags: ["journal-batches"],
    query: SearchJournalBatchQuerySchema,
    itemDescription: "仕訳バッチ(DB_JOURNAL)",
  }),
  async (c) => {
    const queryParams = c.req.query();
    const parsed = v.safeParse(SearchJournalBatchQuerySchema, queryParams);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const sort = { sortBy: parsed.output.sortBy, sortOrder: parsed.output.sortOrder };
    const paginationParams = parsePaginationParams(queryParams);
    const result = await getService(c).searchBatchesPage(c, parsed.output, paginationParams, sort);
    return c.json(result);
  },
);

// ==========================================
// K-6-3: 仕訳バッチ詳細(明細+同一系列の連鎖込み)
// ==========================================
journalBatchesRouter.get(
  "/:id",
  describeApiRoute({
    summary: "仕訳バッチ詳細取得(連鎖込み)",
    tags: ["journal-batches"],
    responses: {
      200: { description: "バッチ詳細+同一系列(元バッチ→反対仕訳→訂正仕訳...)の一覧" },
      404: { description: "対象のバッチが見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const detail = await getService(c).getBatchDetail(id);
    if (!detail) {
      return c.json({ success: false, message: "対象の仕訳バッチが見つかりません" }, 404);
    }
    return c.json(detail);
  },
);

// ==========================================
// K-6-1/K-6-2: 訂正(反対仕訳+訂正仕訳をセットで起票)
// ==========================================
journalBatchesRouter.post(
  "/:id/correct",
  describeMutationRoute({
    summary: "仕訳バッチの訂正(反対仕訳+訂正仕訳を起票)",
    tags: ["journal-batches"],
    json: CorrectJournalBatchPayloadSchema,
    successDescription: "起票成功",
    errors: [
      { status: 400, description: "入力データ検証エラー、既に訂正済み、勘定科目不正等" },
      { status: 404, description: "対象のバッチが見つからない" },
    ],
  }),
  async (c) => {
    const id = c.req.param("id");
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }
    const parsed = v.safeParse(CorrectJournalBatchPayloadSchema, rawBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const result = await getService(c).correctBatch(c, id, parsed.output);
    return c.json(result);
  },
);

export { journalBatchesRouter };
