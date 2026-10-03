import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { CashReceiptsRepository } from "./cash-receipts.repository";
import { CashReceiptsService } from "./cash-receipts.service";
import {
  LinkCashReceiptSchema,
  RegisterCashReceiptSchema,
  SearchCashReceiptsQuerySchema,
} from "./cash-receipts.schema";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { describeApiRoute, describeCsvDownloadRoute } from "../../../platform/openapi/describe-route";
import { todayJst } from "../../../platform/date/format-jst-date";

const cashReceiptsRouter = new Hono<{ Bindings: Env }>();

cashReceiptsRouter.onError((err, c) => respondError(c, err));

const getService = (c: any) => new CashReceiptsService(new CashReceiptsRepository(c.env.DB));

// ==========================================
// 追加要望L-1-a: 単体入金(請求を介さない入金。後から請求へ紐づけて消込)
// ==========================================
cashReceiptsRouter.get(
  "/",
  describeApiRoute({
    summary: "単体入金の一覧(取引先・状態・期間で絞り込み)",
    tags: ["sales-cash-receipts"],
    query: SearchCashReceiptsQuerySchema,
    responses: { 200: { description: "入金の配列(入金日の新しい順)" } },
  }),
  async (c) => {
    const parsed = v.safeParse(SearchCashReceiptsQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).list(parsed.output));
  },
);

cashReceiptsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "単体入金CSVダウンロード(検索条件を反映)", tags: ["sales-cash-receipts"] }),
  async (c) => {
    const parsed = v.safeParse(SearchCashReceiptsQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    const csv = await getService(c).exportCsv(c, parsed.output);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cash_receipts_export_${todayJst()}.csv"`,
    });
  },
);

cashReceiptsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "単体入金の詳細",
    tags: ["sales-cash-receipts"],
    responses: { 200: { description: "入金" }, 404: { description: "存在しない" } },
  }),
  async (c) => c.json(await getService(c).getById(c.req.param("id"))),
);

cashReceiptsRouter.post(
  "/register",
  describeApiRoute({
    summary: "単体入金の登録",
    tags: ["sales-cash-receipts"],
    json: RegisterCashReceiptSchema,
    responses: { 200: { description: "登録成功({success, id})" }, 400: { description: "入力不正" } },
  }),
  async (c) => {
    const parsed = v.safeParse(RegisterCashReceiptSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).register(c, parsed.output));
  },
);

cashReceiptsRouter.post(
  "/:id/link",
  describeApiRoute({
    summary: "単体入金を請求へ紐づけて消込する",
    tags: ["sales-cash-receipts"],
    json: LinkCashReceiptSchema,
    responses: {
      200: { description: "消込結果(reconciledAmount / reconciliationStatus)" },
      400: { description: "取引先不一致・紐づけ済み等" },
      404: { description: "入金または請求が存在しない" },
    },
  }),
  async (c) => {
    const parsed = v.safeParse(LinkCashReceiptSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).link(c, c.req.param("id"), parsed.output));
  },
);

cashReceiptsRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "未紐づけの単体入金を削除",
    tags: ["sales-cash-receipts"],
    responses: { 200: { description: "削除成功" }, 400: { description: "紐づけ済みは削除不可" }, 404: { description: "存在しない" } },
  }),
  async (c) => c.json(await getService(c).remove(c, c.req.param("id"))),
);

export { cashReceiptsRouter };
