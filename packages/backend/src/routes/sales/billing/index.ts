import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { BillingRepository } from "./billing.repository";
import { BillingService } from "./billing.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import { describeApiRoute, describeListRoute, describeCsvDownloadRoute } from "../../../platform/openapi/describe-route";
import {
  SearchBillingQuerySchema,
  CreateBillingPayloadSchema,
  PaymentReceiptPayloadSchema,
  SingleSendEmailSchema,
  BulkSendEmailSchema,
  RequestDownloadOtpSchema,
  VerifyDownloadOtpSchema,
} from "./billing.schema";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { getWithFallback } from "../../../platform/r2/bucket-with-fallback";
import { todayJst } from "../../../platform/date/format-jst-date";

type Variables = {
  billingService: BillingService;
};

const billingRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

billingRouter.use("*", async (c, next) => {
  const repo = new BillingRepository(c.env.DB);
  c.set("billingService", new BillingService(repo));
  await next();
});

billingRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): BillingService => c.get("billingService");

// ==========================================
// 1. 検索機能付き一覧取得
// ==========================================
billingRouter.get(
  "/",
  describeListRoute({
    summary: "請求一覧検索",
    tags: ["sales-billing"],
    query: SearchBillingQuerySchema,
    itemDescription: "請求",
  }),
  async (c) => {
    const queryParams = c.req.query();
    const parsed = v.safeParse(SearchBillingQuerySchema, queryParams);
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
// 2. CSVエクスポート(請求)
// ==========================================
billingRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "請求CSVダウンロード", tags: ["sales-billing"] }),
  async (c) => {
    const csvContent = await getService(c).exportCsv(c);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="billing_export_${todayJst()}.csv"`,
    });
  },
);

// ==========================================
// 3. CSVインポート(請求)
// ==========================================
billingRouter.post(
  "/bulk-register",
  describeApiRoute({
    summary: "請求CSVインポート",
    tags: ["sales-billing"],
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
// 4. CSVエクスポート/インポート(入金消込)
// ==========================================
billingRouter.get(
  "/payment-receipts/csv-download",
  describeCsvDownloadRoute({ summary: "入金消込CSVダウンロード", tags: ["sales-billing"] }),
  async (c) => {
    const csvContent = await getService(c).exportPaymentReceiptsCsv(c);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payment_receipts_export_${todayJst()}.csv"`,
    });
  },
);

billingRouter.post(
  "/payment-receipts/bulk-register",
  describeApiRoute({
    summary: "入金消込CSVインポート",
    tags: ["sales-billing"],
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
    const result = await getService(c).bulkImportPaymentReceiptsCsv(c, file);
    return c.json(result);
  },
);

// ==========================================
// 5. 個別詳細取得
// ==========================================
billingRouter.get(
  "/:id",
  describeApiRoute({
    summary: "請求個別詳細取得",
    tags: ["sales-billing"],
    responses: {
      200: { description: "請求詳細(明細・入金消込履歴込み)" },
      404: { description: "対象の請求が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const detail = await getService(c).getBillingDetail(c, id);
    if (!detail) {
      return c.json({ success: false, message: "対象の請求が見つかりません" }, 404);
    }
    return c.json(detail);
  },
);

// ==========================================
// 6. 新規作成(対象の売上を束ねて請求を作成)
// ==========================================
billingRouter.post(
  "/register",
  describeApiRoute({
    summary: "請求新規登録",
    tags: ["sales-billing"],
    json: CreateBillingPayloadSchema,
    responses: {
      200: { description: "作成成功" },
      400: { description: "バリデーションエラー(モード不整合、対象売上が承認済み/未請求でない等)" },
      404: { description: "対象の売上が見つからない" },
    },
  }),
  async (c) => {
    const jsonBody = await c.req.json().catch(() => null);
    if (!jsonBody) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(CreateBillingPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).createBilling(c, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 追加要望: 請求削除
// ==========================================
billingRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "請求削除",
    tags: ["sales-billing"],
    responses: {
      200: { description: "削除成功" },
      400: { description: "入金消込が記録されているため削除できない" },
      404: { description: "対象の請求データが見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).deleteBilling(c, id);
    return c.json(result);
  },
);

// ==========================================
// 7. 入金消込記録
// ==========================================
billingRouter.post(
  "/:id/payment-receipts",
  describeApiRoute({
    summary: "入金消込記録",
    tags: ["sales-billing"],
    json: PaymentReceiptPayloadSchema,
    responses: {
      200: { description: "記録成功" },
      404: { description: "対象の請求が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const jsonBody = await c.req.json().catch(() => null);
    if (!jsonBody) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(PaymentReceiptPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).recordPaymentReceipt(c, id, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 8. 請求書PDF発行
// ==========================================
billingRouter.post(
  "/:id/generate-pdf",
  describeApiRoute({
    summary: "請求書PDF発行(都度=対象売上のPDFをそのまま発行、締め=合算PDFを新規生成)",
    tags: ["sales-billing"],
    responses: {
      200: { description: "生成成功" },
      404: { description: "対象データがない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).generatePdf(c, id);
    if (!result) {
      return c.json({ success: false, message: "対象データがありません" }, 404);
    }
    return c.json(result);
  },
);

// ==========================================
// K-4-4: 請求書の再発行(保存済みPDFの再ダウンロード・再送付)
// ==========================================
billingRouter.get(
  "/:id/download-pdf",
  describeApiRoute({
    summary: "請求書PDFの再ダウンロード(初回発行時に保存されたPDFをそのまま返す)",
    tags: ["sales-billing"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "対象データがない、または未発行" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const { header } = await getService(c).getDownloadStream(id);

    const fileObject = await getWithFallback({ primary: c.env.BILLING_BUCKET, legacy: c.env.QUATES_BUCKET }, header.invoicePdfR2Path!);
    if (!fileObject) {
      return c.json({ success: false, message: "R2ストレージ上に実体ファイルが存在しません" }, 404);
    }

    const headers = {
      "Content-Type": fileObject.httpMetadata?.contentType || "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(await resolveDocumentFileName(c.env.DB, "billing_invoice", id))}`,
    };
    return c.body(fileObject.body, 200, headers);
  },
);

billingRouter.post(
  "/:id/send-email",
  describeApiRoute({
    summary: "請求書の送信・再送付(PDF未発行の場合は送信時に自動生成する)",
    tags: ["sales-billing"],
    json: SingleSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "送信先メールアドレスの入力内容に不備" },
      404: { description: "対象の請求データが見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = v.safeParse(SingleSendEmailSchema, body);

    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).sendEmail(c, id, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 追加要望: 一覧からの一括メール送信(PDF未発行の請求は送信時に自動生成する)
// ==========================================
billingRouter.post(
  "/bulk-send-email",
  describeApiRoute({
    summary: "請求書の一括メール送信",
    tags: ["sales-billing"],
    json: BulkSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "バリデーションエラー" },
      404: { description: "対象の請求データが見つからない" },
    },
  }),
  async (c) => {
    const body = await c.req.json();
    const parsed = v.safeParse(BulkSendEmailSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).sendBulkEmail(c, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 追加要望: OTPダウンロード(外部公開エンドポイント。API_KEYチェック対象外、
// src/index.tsの許可リストに本ルートのパスパターンを明示的に追加している)
// ==========================================
billingRouter.post(
  "/download-request/:id",
  describeApiRoute({
    summary: "請求書PDFダウンロード用OTPの発行(外部公開)",
    tags: ["sales-billing"],
    json: RequestDownloadOtpSchema,
    responses: {
      200: { description: "OTP送信要求を受け付けた(登録済みメールの場合のみ実際に送信)" },
      400: { description: "バリデーションエラー" },
      404: { description: "対象の請求データが存在しない、または請求書PDF未発行" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = v.safeParse(RequestDownloadOtpSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const result = await getService(c).requestDownloadOtp(c, id, parsed.output.email);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

billingRouter.post(
  "/download-verify/:id",
  describeApiRoute({
    summary: "請求書PDFダウンロード用OTPの検証・ファイル配信(外部公開)",
    tags: ["sales-billing"],
    json: VerifyDownloadOtpSchema,
    responses: {
      200: { description: "ファイル本体" },
      400: { description: "OTPが不正・期限切れ・試行回数超過" },
      404: { description: "対象ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = v.safeParse(VerifyDownloadOtpSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const { header } = await getService(c).verifyDownloadOtp(
        c,
        id,
        parsed.output.email,
        parsed.output.otp,
      );

      const fileObject = await getWithFallback({ primary: c.env.BILLING_BUCKET, legacy: c.env.QUATES_BUCKET }, header.invoicePdfR2Path!);
      if (!fileObject) {
        return c.json(
          { success: false, message: "R2ストレージ上に実体ファイルが存在しません" },
          404,
        );
      }

      const encodedFileName = encodeURIComponent(await resolveDocumentFileName(c.env.DB, "billing_invoice", id));
      const headers = {
        "Content-Type": fileObject.httpMetadata?.contentType || "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodedFileName}`,
      };
      return c.body(fileObject.body, 200, headers);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

export { billingRouter };
