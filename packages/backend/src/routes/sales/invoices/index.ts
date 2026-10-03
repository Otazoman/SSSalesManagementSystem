import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { SalesInvoiceService } from "./sales-invoice.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import { describeApiRoute, describeListRoute, describeCsvDownloadRoute } from "../../../platform/openapi/describe-route";
import {
  SearchSalesInvoicesQuerySchema,
  SalesInvoicePayloadSchema,
  RequestDownloadOtpSchema,
  VerifyDownloadOtpSchema,
  BulkSendEmailSchema,
  SingleSendEmailSchema,
} from "./sales-invoice.schema";
import { getWithFallback } from "../../../platform/r2/bucket-with-fallback";
import { todayJst } from "../../../platform/date/format-jst-date";

type Variables = {
  salesInvoiceService: SalesInvoiceService;
};

const salesInvoicesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

salesInvoicesRouter.use("*", async (c, next) => {
  const repo = new SalesInvoiceRepository(c.env.DB);
  c.set("salesInvoiceService", new SalesInvoiceService(repo));
  await next();
});

salesInvoicesRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): SalesInvoiceService => c.get("salesInvoiceService");

// ==========================================
// 1. 検索機能付き一覧取得
// ==========================================
salesInvoicesRouter.get(
  "/",
  describeListRoute({
    summary: "売上一覧検索",
    tags: ["sales-invoices"],
    query: SearchSalesInvoicesQuerySchema,
    itemDescription: "売上(添付ファイル込み)",
  }),
  async (c) => {
    const queryParams = c.req.query();
    const parsed = v.safeParse(SearchSalesInvoicesQuerySchema, queryParams);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const rawQuery = c.req.query();
    const sort = { sortBy: parsed.output.sortBy, sortOrder: parsed.output.sortOrder };
    if (rawQuery.page === undefined && rawQuery.limit === undefined) {
      const result = await getService(c).searchInvoices(c, parsed.output, sort);
      return c.json(result);
    }
    const paginationParams = parsePaginationParams(rawQuery);
    const result = await getService(c).searchInvoicesPage(c, parsed.output, paginationParams, sort);
    return c.json(result);
  },
);

// ==========================================
// 2. CSVエクスポート
// ==========================================
salesInvoicesRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "売上CSVダウンロード", tags: ["sales-invoices"] }),
  async (c) => {
    const csvContent = await getService(c).exportCsv(c);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales_invoices_export_${todayJst()}.csv"`,
    });
  },
);

// ==========================================
// 3. CSVインポート
// ==========================================
salesInvoicesRouter.post(
  "/bulk-register",
  describeApiRoute({
    summary: "売上CSVインポート",
    tags: ["sales-invoices"],
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
// 受注から選択(ピッカー)用: 受注明細ごとの残数量取得
// ==========================================
salesInvoicesRouter.get(
  "/order-progress/:salesOrderId",
  describeApiRoute({
    summary: "受注明細ごとの売上残数量取得(受注から選択ピッカー用)",
    tags: ["sales-invoices"],
    responses: {
      200: { description: "受注明細ごとの残数量一覧" },
      404: { description: "対象の受注が見つからない" },
    },
  }),
  async (c) => {
    const salesOrderId = c.req.param("salesOrderId");
    const result = await getService(c).getOrderInvoiceProgress(c, salesOrderId);
    return c.json(result);
  },
);

// ==========================================
// 4. 個別詳細取得
// ==========================================
salesInvoicesRouter.get(
  "/:id",
  describeApiRoute({
    summary: "売上個別詳細取得",
    tags: ["sales-invoices"],
    responses: {
      200: { description: "売上詳細" },
      404: { description: "対象の売上が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const detail = await getService(c).getInvoiceDetail(c, id);
    if (!detail) {
      return c.json({ success: false, message: "対象の売上が見つかりません" }, 404);
    }
    return c.json(detail);
  },
);

// ==========================================
// 5. 新規登録
// ==========================================
salesInvoicesRouter.post(
  "/register",
  describeApiRoute({
    summary: "売上新規登録",
    tags: ["sales-invoices"],
    responses: {
      200: { description: "登録成功" },
      400: { description: "invoiceData未送信、JSON不正、またはバリデーションエラー" },
    },
  }),
  async (c) => {
    const formData = await c.req.formData();
    const dataStr = formData.get("invoiceData") as string;
    if (!dataStr) {
      return c.json({ success: false, message: "売上データ(invoiceData)が送信されていません" }, 400);
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(dataStr);
    } catch {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(SalesInvoicePayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).createInvoice(c, formData, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 6. 修正
// ==========================================
salesInvoicesRouter.put(
  "/:id",
  describeApiRoute({
    summary: "売上修正",
    tags: ["sales-invoices"],
    responses: {
      200: { description: "更新成功" },
      400: { description: "修正データ未送信、JSON不正、またはバリデーションエラー" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const formData = await c.req.formData();
    const dataStr = formData.get("invoiceData") as string;
    if (!dataStr) {
      return c.json({ success: false, message: "修正データが見つかりません" }, 400);
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(dataStr);
    } catch {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(SalesInvoicePayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).updateInvoice(c, id, formData, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 7. 削除
// ==========================================
salesInvoicesRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "売上削除",
    tags: ["sales-invoices"],
    responses: { 200: { description: "削除成功" } },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).deleteInvoice(c, id);
    return c.json(result);
  },
);

// ==========================================
// 8. 承認申請提出
// ==========================================
salesInvoicesRouter.post(
  "/:id/submit-for-approval",
  describeApiRoute({
    summary: "売上の承認申請",
    tags: ["sales-invoices"],
    responses: {
      200: { description: "申請成功(または承認機能OFF時は直接確定)" },
      400: { description: "下書き状態でない、または承認フロー未定義等" },
      404: { description: "対象の売上が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const result = await getService(c).submitForApproval(
      c,
      id,
      body?.applicantDepartmentSurrogateId || null,
    );
    return c.json(result);
  },
);

// ==========================================
// 9. 削除申請
// ==========================================
salesInvoicesRouter.post(
  "/:id/request-deletion",
  describeApiRoute({
    summary: "売上の削除申請(または未申請DRAFTの直接削除)",
    tags: ["sales-invoices"],
    responses: {
      200: { description: "削除成功、または削除申請の申請成功" },
      400: { description: "承認処理中等、削除申請できない状態" },
      404: { description: "対象の売上が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).requestInvoiceDeletion(c, id);
    return c.json(result);
  },
);

// ==========================================
// 10. PDF生成
// ==========================================
salesInvoicesRouter.post(
  "/:id/generate-pdf",
  describeApiRoute({
    summary: "売上計上書PDF生成",
    tags: ["sales-invoices"],
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
// 添付ファイルのストリーミング配信・ダウンロード
// ==========================================
salesInvoicesRouter.get(
  "/download/:id/:attachmentId",
  describeApiRoute({
    summary: "売上添付ファイル配信・ダウンロード",
    tags: ["sales-invoices"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "R2上に実体ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");

    const { attachment } = await getService(c).getDownloadStream(id, attachmentId);

    const fileObject = await getWithFallback({ primary: c.env.SALES_INVOICES_BUCKET, legacy: c.env.QUATES_BUCKET }, attachment.attachmentR2Path!);
    if (!fileObject) {
      return c.json({ success: false, message: "R2ストレージ上に実体ファイルが存在しません" }, 404);
    }

    const encodedFileName = encodeURIComponent(attachment.fileName);
    const headers = {
      "Content-Type": fileObject.httpMetadata?.contentType || "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodedFileName}`,
    };
    return c.body(fileObject.body, 200, headers);
  },
);

// ==========================================
// K-4-1: OTPダウンロード(外部公開エンドポイント。API_KEYチェック対象外、
// src/index.tsの許可リストに本ルートのパスパターンを明示的に追加している)
// ==========================================
salesInvoicesRouter.post(
  "/download-request/:id/:attachmentId",
  describeApiRoute({
    summary: "売上関連書類ダウンロード用OTPの発行(外部公開)",
    tags: ["sales-invoices"],
    json: RequestDownloadOtpSchema,
    responses: {
      200: { description: "OTP送信要求を受け付けた(登録済みメールの場合のみ実際に送信)" },
      400: { description: "バリデーションエラー" },
      404: { description: "対象の売上・添付ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");
    const body = await c.req.json();
    const parsed = v.safeParse(RequestDownloadOtpSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const result = await getService(c).requestDownloadOtp(
        c,
        id,
        attachmentId,
        parsed.output.email,
      );
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

salesInvoicesRouter.post(
  "/download-verify/:id/:attachmentId",
  describeApiRoute({
    summary: "売上関連書類ダウンロード用OTPの検証・ファイル配信(外部公開)",
    tags: ["sales-invoices"],
    json: VerifyDownloadOtpSchema,
    responses: {
      200: { description: "ファイル本体" },
      400: { description: "OTPが不正・期限切れ・試行回数超過" },
      404: { description: "対象ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");
    const body = await c.req.json();
    const parsed = v.safeParse(VerifyDownloadOtpSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const { attachment } = await getService(c).verifyDownloadOtp(
        c,
        id,
        attachmentId,
        parsed.output.email,
        parsed.output.otp,
      );

      const fileObject = await getWithFallback({ primary: c.env.SALES_INVOICES_BUCKET, legacy: c.env.QUATES_BUCKET }, attachment.attachmentR2Path!);
      if (!fileObject) {
        return c.json(
          { success: false, message: "R2ストレージ上に実体ファイルが存在しません" },
          404,
        );
      }

      const encodedFileName = encodeURIComponent(attachment.fileName);
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

// ==========================================
// K-4-1: 承認済売上関連書類の一括メール配信
// ==========================================
salesInvoicesRouter.post(
  "/bulk-send-email",
  describeApiRoute({
    summary: "承認済み売上関連書類の一括メール送信",
    tags: ["sales-invoices"],
    json: BulkSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "バリデーションエラー" },
      404: { description: "承認済みかつ有効な売上データが見つからない" },
    },
  }),
  async (c) => {
    const body = await c.req.json();
    const parsed = v.safeParse(BulkSendEmailSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const result = await getService(c).bulkSendEmail(c, parsed.output);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// ==========================================
// K-4-1: 個別売上関連書類の単独メール配信
// ==========================================
salesInvoicesRouter.post(
  "/:id/send-email",
  describeApiRoute({
    summary: "個別売上関連書類の個別メール送信",
    tags: ["sales-invoices"],
    json: SingleSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "送信先メールアドレスの入力内容に不備" },
      404: { description: "承認済みかつ有効な売上データが見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = v.safeParse(SingleSendEmailSchema, body);

    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const result = await getService(c).singleSendEmail(c, id, parsed.output);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

export { salesInvoicesRouter };
