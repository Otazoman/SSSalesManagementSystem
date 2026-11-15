import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { StockTransfersService } from "./transfers.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { describeApiRoute, describeListRoute } from "../../../platform/openapi/describe-route";
import {
  CloseStockTransferSchema,
  CreateStockTransferSchema,
  ReceiveStockTransferSchema,
  SearchStockTransfersQuerySchema,
} from "./transfers.schema";

// REQ-006: 倉庫間移動(/api/stock-transfers)
const stockTransfersRouter = new Hono<{ Bindings: Env }>();
stockTransfersRouter.onError((err, c) => respondError(c, err));
const service = new StockTransfersService();

stockTransfersRouter.get(
  "/",
  describeListRoute({ summary: "倉庫間移動の一覧", tags: ["stock-transfers"], query: SearchStockTransfersQuerySchema, itemDescription: "倉庫間移動(明細つき)" }),
  async (c) => {
    const parsed = v.safeParse(SearchStockTransfersQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.list(c, parsed.output));
  },
);

stockTransfersRouter.get(
  "/in-transit",
  describeApiRoute({ summary: "輸送中の在庫(品目・倉庫で絞り込める)", tags: ["stock-transfers"], responses: { 200: { description: "輸送中の明細" } } }),
  async (c) => c.json(await service.listInTransit(c, { itemId: c.req.query("itemId"), warehouseId: c.req.query("warehouseId") })),
);

stockTransfersRouter.get(
  "/:id",
  describeApiRoute({ summary: "倉庫間移動の詳細", tags: ["stock-transfers"], responses: { 200: { description: "倉庫間移動" }, 404: { description: "見つからない" } } }),
  async (c) => c.json(await service.getDetail(c, c.req.param("id"))),
);

stockTransfersRouter.post(
  "/register",
  describeApiRoute({
    summary: "倉庫間移動の作成(移動元の出庫、外部倉庫なら出荷指示・入荷指示を作る)",
    tags: ["stock-transfers"],
    json: CreateStockTransferSchema,
    responses: { 200: { description: "作成成功" }, 400: { description: "入力エラー・在庫不足等" } },
  }),
  async (c) => {
    const parsed = v.safeParse(CreateStockTransferSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.create(c, parsed.output));
  },
);

stockTransfersRouter.post(
  "/:id/receive",
  describeApiRoute({
    summary: "倉庫間移動の入庫(移動先が自社倉庫。分けて入庫できる)",
    tags: ["stock-transfers"],
    json: ReceiveStockTransferSchema,
    responses: { 200: { description: "入庫成功(承認が有効なら申請)" }, 400: { description: "残りを超える等" } },
  }),
  async (c) => {
    const parsed = v.safeParse(ReceiveStockTransferSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.receive(c, c.req.param("id"), parsed.output));
  },
);

stockTransfersRouter.post(
  "/:id/close",
  describeApiRoute({
    summary: "倉庫間移動を差異で完了(届かない分を差異として記録。在庫は戻さない)",
    tags: ["stock-transfers"],
    json: CloseStockTransferSchema,
    responses: { 200: { description: "完了" }, 400: { description: "輸送中でない・承認待ちの入庫がある" } },
  }),
  async (c) => {
    const parsed = v.safeParse(CloseStockTransferSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.closeWithDifference(c, c.req.param("id"), parsed.output));
  },
);

export { stockTransfersRouter };
