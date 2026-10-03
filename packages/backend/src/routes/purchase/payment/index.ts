import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { PaymentRepository } from "./payment.repository";
import { PaymentService } from "./payment.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import { describeApiRoute, describeListRoute, describeCsvDownloadRoute, describeMutationRoute } from "../../../platform/openapi/describe-route";
import {
  SearchPaymentQuerySchema,
  CreatePaymentPayloadSchema,
  PaymentDisbursementPayloadSchema,
  ExportFirmBankingPayloadSchema,
} from "./payment.schema";
import { todayJst } from "../../../platform/date/format-jst-date";

type Variables = {
  paymentService: PaymentService;
};

const paymentRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

paymentRouter.use("*", async (c, next) => {
  const repo = new PaymentRepository(c.env.DB);
  c.set("paymentService", new PaymentService(repo));
  await next();
});

paymentRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): PaymentService => c.get("paymentService");

// ==========================================
// 1. 検索機能付き一覧取得
// ==========================================
paymentRouter.get(
  "/",
  describeListRoute({
    summary: "支払一覧検索",
    tags: ["purchase-payment"],
    query: SearchPaymentQuerySchema,
    itemDescription: "支払",
  }),
  async (c) => {
    const queryParams = c.req.query();
    const parsed = v.safeParse(SearchPaymentQuerySchema, queryParams);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const rawQuery = c.req.query();
    const sort = { sortBy: parsed.output.sortBy, sortOrder: parsed.output.sortOrder };
    if (rawQuery.page === undefined && rawQuery.limit === undefined) {
      const result = await getService(c).searchHeaders(c, parsed.output, sort);
      return c.json(result);
    }
    const paginationParams = parsePaginationParams(rawQuery);
    const result = await getService(c).searchHeadersPage(c, parsed.output, paginationParams, sort);
    return c.json(result);
  },
);

// ==========================================
// 2. CSVエクスポート(支払)
// ==========================================
paymentRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "支払CSVダウンロード", tags: ["purchase-payment"] }),
  async (c) => {
    const csvContent = await getService(c).exportCsv(c);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payment_export_${todayJst()}.csv"`,
    });
  },
);

// ==========================================
// 3. CSVインポート(支払)
// ==========================================
paymentRouter.post(
  "/bulk-register",
  describeApiRoute({
    summary: "支払CSVインポート",
    tags: ["purchase-payment"],
    responses: {
      200: { description: "インポート成功" },
      400: { description: "CSVファイル未添付" },
    },
  }),
  async (c) => {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json({ success: false, message: "CSVファイルが添付されていません" }, 400);
    }
    const result = await getService(c).bulkImportCsv(c, file);
    return c.json(result);
  },
);

// ==========================================
// 4. CSVエクスポート/インポート(支払消込)
// ==========================================
paymentRouter.get(
  "/disbursements/csv-download",
  describeCsvDownloadRoute({ summary: "支払消込CSVダウンロード", tags: ["purchase-payment"] }),
  async (c) => {
    const csvContent = await getService(c).exportDisbursementsCsv(c);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payment_disbursements_export_${todayJst()}.csv"`,
    });
  },
);

paymentRouter.post(
  "/disbursements/bulk-register",
  describeApiRoute({
    summary: "支払消込CSVインポート",
    tags: ["purchase-payment"],
    responses: {
      200: { description: "インポート成功" },
      400: { description: "CSVファイル未添付" },
    },
  }),
  async (c) => {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json({ success: false, message: "CSVファイルが添付されていません" }, 400);
    }
    const result = await getService(c).bulkImportDisbursementsCsv(c, file);
    return c.json(result);
  },
);

// ==========================================
// 5. K-5-1: 支払作成モーダル「検収から選択」タブ用の候補一覧
// ==========================================
paymentRouter.get(
  "/candidate-item-receipts",
  describeApiRoute({
    summary: "支払対象候補の検収記録一覧取得",
    tags: ["purchase-payment"],
    responses: {
      200: { description: "承認済み・対象取引先・未使用の検収記録一覧(発注紐付き分は金額自動計算込み)" },
    },
  }),
  async (c) => {
    const partnerId = c.req.query("partnerId") || "";
    const result = await getService(c).listCandidateItemReceipts(c, partnerId);
    return c.json(result);
  },
);

// ==========================================
// 5b. K-5-2: 支払作成モーダル「仕入から選択」タブ用の候補一覧(前払実績込み)
// ==========================================
paymentRouter.get(
  "/candidate-recognitions",
  describeApiRoute({
    summary: "支払対象候補の仕入計上一覧取得",
    tags: ["purchase-payment"],
    responses: {
      200: { description: "未払・承認済みの仕入計上一覧(前払済み発注に紐づく分はisAdvancePrepaid込み)" },
    },
  }),
  async (c) => {
    const partnerId = c.req.query("partnerId") || "";
    const result = await getService(c).listCandidateRecognitions(c, partnerId);
    return c.json(result);
  },
);

// ==========================================
// 5c. ファームバンキング: 振込データファイル作成前の確認(件数・金額・警告をJSONで返す)
// ==========================================
paymentRouter.post(
  "/firm-banking-preview",
  describeMutationRoute({
    summary: "ファームバンキング振込データ作成前の確認(件数・合計金額・変換警告)",
    tags: ["purchase-payment"],
    json: ExportFirmBankingPayloadSchema,
    successDescription: "確認結果",
    errors: [
      { status: 400, description: "入力データ検証エラー、会社設定未整備、振込先口座未登録等" },
      { status: 404, description: "対象の支払の一部が見つからない" },
    ],
  }),
  async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }
    const parsed = v.safeParse(ExportFirmBankingPayloadSchema, rawBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const result = await getService(c).previewFirmBankingFile(
      c,
      parsed.output.paymentHeaderIds,
      parsed.output.transferDate,
    );
    return c.json(result);
  },
);

// ==========================================
// 5d. ファームバンキング: 全銀「総合振込」フォーマットの振込データファイル作成
// ==========================================
paymentRouter.post(
  "/firm-banking-export",
  describeMutationRoute({
    summary: "ファームバンキング振込データファイル作成(全銀総合振込フォーマット)",
    tags: ["purchase-payment"],
    json: ExportFirmBankingPayloadSchema,
    successDescription: "ファイル本体(application/octet-stream)",
    errors: [
      { status: 400, description: "入力データ検証エラー、会社設定未整備、振込先口座未登録等" },
      { status: 404, description: "対象の支払の一部が見つからない" },
    ],
  }),
  async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }
    const parsed = v.safeParse(ExportFirmBankingPayloadSchema, rawBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const result = await getService(c).exportFirmBankingFile(
      c,
      parsed.output.paymentHeaderIds,
      parsed.output.transferDate,
    );
    const dateStamp = parsed.output.transferDate.replace(/-/g, "");
    return c.body(result.bytes, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="furikomi_${dateStamp}.txt"`,
    });
  },
);

// ==========================================
// 6. 個別詳細取得
// ==========================================
paymentRouter.get(
  "/:id",
  describeApiRoute({
    summary: "支払個別詳細取得",
    tags: ["purchase-payment"],
    responses: {
      200: { description: "支払詳細(明細・消込履歴込み)" },
      404: { description: "対象の支払が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const detail = await getService(c).getPaymentDetail(c, id);
    if (!detail) {
      return c.json({ success: false, message: "対象の支払が見つかりません" }, 404);
    }
    return c.json(detail);
  },
);

// ==========================================
// 7. 新規作成(対象の仕入を束ねて支払を確定)
// ==========================================
paymentRouter.post(
  "/register",
  describeApiRoute({
    summary: "支払新規登録(支払確定)",
    tags: ["purchase-payment"],
    json: CreatePaymentPayloadSchema,
    responses: {
      200: { description: "作成成功" },
      400: { description: "バリデーションエラー(モード不整合、対象仕入が承認済み/未払でない等)" },
      404: { description: "対象の仕入が見つからない" },
    },
  }),
  async (c) => {
    const jsonBody = await c.req.json().catch(() => null);
    if (!jsonBody) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(CreatePaymentPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).createPayment(c, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 8. 支払消込記録
// ==========================================
paymentRouter.post(
  "/:id/disbursements",
  describeApiRoute({
    summary: "支払消込記録",
    tags: ["purchase-payment"],
    json: PaymentDisbursementPayloadSchema,
    responses: {
      200: { description: "記録成功" },
      404: { description: "対象の支払が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const jsonBody = await c.req.json().catch(() => null);
    if (!jsonBody) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(PaymentDisbursementPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).recordDisbursement(c, id, parsed.output);
    return c.json(result);
  },
);

export { paymentRouter };
