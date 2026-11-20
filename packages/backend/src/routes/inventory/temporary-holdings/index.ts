import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { TemporaryHoldingsRepository } from "./temporary-holdings.repository";
import { TemporaryHoldingsService } from "./temporary-holdings.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { describeApiRoute, describeListRoute, describeCsvDownloadRoute } from "../../../platform/openapi/describe-route";
import { todayJst } from "../../../platform/date/format-jst-date";
import {
  AdjustTemporaryHoldingSchema,
  MoveTemporaryHoldingToStockSchema,
  ReceiveTemporaryHoldingSchema,
  ReleaseTemporaryHoldingSchema,
  SearchTemporaryHoldingsQuerySchema,
} from "./temporary-holdings.schema";

// REQ-011(2): 一時保管の台帳(在庫・棚卸管理の「一時保管」タブ)
const temporaryHoldingsRouter = new Hono<{ Bindings: Env }>();
temporaryHoldingsRouter.onError((err, c) => respondError(c, err));

const getService = (c: any) => new TemporaryHoldingsService(new TemporaryHoldingsRepository(c.env.DB));

temporaryHoldingsRouter.get(
  "/",
  describeListRoute({
    summary: "一時保管の一覧",
    tags: ["temporary-holdings"],
    query: SearchTemporaryHoldingsQuerySchema,
    itemDescription: "一時保管(承認待ちの増減 pendingQuantity つき)",
  }),
  async (c) => {
    const parsed = v.safeParse(SearchTemporaryHoldingsQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).list(parsed.output));
  },
);

temporaryHoldingsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "一時保管のCSVダウンロード", tags: ["temporary-holdings"] }),
  async (c) => {
    const parsed = v.safeParse(SearchTemporaryHoldingsQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    const csv = await getService(c).exportCsv(c, parsed.output);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="temporary_holdings_export_${todayJst()}.csv"`,
    });
  },
);

temporaryHoldingsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "一時保管の詳細(動きの履歴つき)",
    tags: ["temporary-holdings"],
    responses: { 200: { description: "一時保管" }, 404: { description: "見つからない" } },
  }),
  async (c) => c.json(await getService(c).getDetail(c.req.param("id"))),
);

temporaryHoldingsRouter.post(
  "/receive",
  describeApiRoute({
    summary: "一時保管への受入(承認フローがあれば申請)",
    tags: ["temporary-holdings"],
    json: ReceiveTemporaryHoldingSchema,
    responses: { 200: { description: "受入成功" }, 400: { description: "入力エラー・承認の申請に失敗" } },
  }),
  async (c) => {
    const parsed = v.safeParse(ReceiveTemporaryHoldingSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).receive(c, parsed.output));
  },
);

temporaryHoldingsRouter.post(
  "/:id/release",
  describeApiRoute({
    summary: "一時保管からの払出(承認フローがあれば申請)",
    tags: ["temporary-holdings"],
    json: ReleaseTemporaryHoldingSchema,
    responses: { 200: { description: "払出成功" }, 400: { description: "残りを超える等" }, 404: { description: "見つからない" } },
  }),
  async (c) => {
    const parsed = v.safeParse(ReleaseTemporaryHoldingSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).release(c, c.req.param("id"), parsed.output));
  },
);

temporaryHoldingsRouter.post(
  "/:id/adjust",
  describeApiRoute({
    summary: "一時保管の数量の調整(承認フローがあれば申請)",
    tags: ["temporary-holdings"],
    json: AdjustTemporaryHoldingSchema,
    responses: { 200: { description: "調整成功" }, 400: { description: "マイナスになる等" }, 404: { description: "見つからない" } },
  }),
  async (c) => {
    const parsed = v.safeParse(AdjustTemporaryHoldingSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).adjust(c, c.req.param("id"), parsed.output));
  },
);

temporaryHoldingsRouter.post(
  "/:id/move-to-stock",
  describeApiRoute({
    summary: "一時保管の自社品を品目マスタの品目として在庫へ移す(残りの数量で入庫を作る)",
    tags: ["temporary-holdings"],
    json: MoveTemporaryHoldingToStockSchema,
    responses: { 200: { description: "入庫を作成(承認が有効なら申請)" }, 400: { description: "預り品・承認待ちがある等" }, 404: { description: "見つからない" } },
  }),
  async (c) => {
    const parsed = v.safeParse(MoveTemporaryHoldingToStockSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).moveToStock(c, c.req.param("id"), parsed.output));
  },
);

temporaryHoldingsRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "一時保管の削除(確定した動きが無い行だけ)",
    tags: ["temporary-holdings"],
    responses: { 200: { description: "削除成功" }, 400: { description: "確定・承認待ちの動きがある" }, 404: { description: "見つからない" } },
  }),
  async (c) => c.json(await getService(c).remove(c, c.req.param("id"))),
);

export { temporaryHoldingsRouter };
