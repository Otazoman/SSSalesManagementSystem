import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { QuoteRepository } from "./quote.repository";
import { QuoteService } from "./quote.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeListRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";
import {
  SearchQuotesQuerySchema,
  QuotePayloadSchema,
  BulkSendEmailSchema,
  SingleSendEmailSchema,
  RequestDownloadOtpSchema,
  VerifyDownloadOtpSchema,
} from "./quote.schema";
import { todayJst } from "../../../platform/date/format-jst-date";

type Variables = {
  quoteService: QuoteService;
};

const quotesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// 各リクエストで Service インスタンスを注入
quotesRouter.use("*", async (c, next) => {
  const repo = new QuoteRepository(c.env.DB);
  c.set("quoteService", new QuoteService(repo));
  await next();
});

// HttpError(業務エラー)はステータス・メッセージをそのまま返し、それ以外は共通500ハンドラーへ
quotesRouter.onError((err, c) => respondError(c, err));

// Helper サービス取得
const getService = (c: any): QuoteService => c.get("quoteService");

// ==========================================
// 1. 検索機能付き一覧取得
// ==========================================
quotesRouter.get(
  "/",
  describeListRoute({
    summary: "見積一覧検索",
    tags: ["quotes"],
    query: SearchQuotesQuerySchema,
    itemDescription: "見積(添付ファイル込み)",
  }),
  async (c) => {
  const queryParams = c.req.query();
  const parsed = v.safeParse(SearchQuotesQuerySchema, queryParams);
  if (!parsed.success) {
    return respondValidationError(c, parsed.issues);
  }

  const rawQuery = c.req.query();
  const sort = { sortBy: parsed.output.sortBy, sortOrder: parsed.output.sortOrder };
  if (rawQuery.page === undefined && rawQuery.limit === undefined) {
    const result = await getService(c).searchQuotes(c, parsed.output, sort);
    return c.json(result);
  }
  const paginationParams = parsePaginationParams(rawQuery);
  const result = await getService(c).searchQuotesPage(
    c,
    parsed.output,
    paginationParams,
    sort,
  );
  return c.json(result);
});

// ==========================================
// 6. CSVエクスポート
// ==========================================
quotesRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "見積CSVダウンロード", tags: ["quotes"] }),
  async (c) => {
  const csvContent = await getService(c).exportCsv(c);
  return c.body(csvContent, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="quotes_export_${todayJst()}.csv"`,
  });
});

// ==========================================
// 7. CSVインポート
// ==========================================
quotesRouter.post(
  "/bulk-register",
  describeApiRoute({
    summary: "見積CSVインポート",
    tags: ["quotes"],
    responses: {
      200: { description: "インポート成功" },
      400: { description: "CSVファイル未添付" },
    },
  }),
  async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return c.json(
      { success: false, message: "CSVファイルが添付されていません" },
      400,
    );
  }

  const result = await getService(c).bulkImportCsv(c, file);
  return c.json(result);
});

// ==========================================
// 2. 個別詳細取得
// ==========================================
quotesRouter.get(
  "/:id",
  describeApiRoute({
    summary: "見積個別詳細取得",
    tags: ["quotes"],
    responses: {
      200: { description: "見積詳細" },
      404: { description: "対象の見積が見つからない" },
    },
  }),
  async (c) => {
  const id = c.req.param("id");
  const detail = await getService(c).getQuoteDetail(c, id);
  if (!detail) {
    return c.json(
      { success: false, message: "対象の見積が見つかりません" },
      404,
    );
  }
  return c.json(detail);
});

// ==========================================
// 3. 見積の新規登録
// ==========================================
quotesRouter.post(
  "/register",
  describeApiRoute({
    summary: "見積新規登録",
    tags: ["quotes"],
    responses: {
      200: { description: "登録成功" },
      400: { description: "quoteData未送信、JSON不正、またはバリデーションエラー(QuotePayloadSchema)" },
    },
  }),
  async (c) => {
  const formData = await c.req.formData();
  const quoteDataStr = formData.get("quoteData") as string;
  if (!quoteDataStr) {
    console.error("[REGISTER ERROR] quoteDataStr is empty");
    return c.json(
      { success: false, message: "見積データ(quoteData)が送信されていません" },
      400,
    );
  }

  let jsonBody: any;
  try {
    jsonBody = JSON.parse(quoteDataStr);
  } catch (e) {
    console.error("[REGISTER ERROR] JSON parse failed:", e);
    return c.json(
      { success: false, message: "JSONフォーマットが不正です" },
      400,
    );
  }

  const parsed = v.safeParse(QuotePayloadSchema, jsonBody);
  if (!parsed.success) {
    // 💡 どこが原因で弾かれたかをターミナルに詳細出力します
    console.error(
      "[REGISTER VALIDATION ERROR]",
      JSON.stringify(parsed.issues, null, 2),
    );
    return respondValidationError(c, parsed.issues);
  }

  const result = await getService(c).createQuote(c, formData, parsed.output);
  return c.json(result);
});

// ==========================================
// 4. 見積の修正
// ==========================================
quotesRouter.put(
  "/:id",
  describeApiRoute({
    summary: "見積修正",
    tags: ["quotes"],
    responses: {
      200: { description: "更新成功" },
      400: { description: "修正データ未送信、JSON不正、またはバリデーションエラー(QuotePayloadSchema)" },
    },
  }),
  async (c) => {
  const id = c.req.param("id");
  const formData = await c.req.formData();
  const quoteDataStr = formData.get("quoteData") as string;
  if (!quoteDataStr) {
    return c.json(
      { success: false, message: "修正データが見つかりません" },
      400,
    );
  }

  let jsonBody: any;
  try {
    jsonBody = JSON.parse(quoteDataStr);
  } catch {
    return c.json(
      { success: false, message: "JSONフォーマットが不正です" },
      400,
    );
  }

  const parsed = v.safeParse(QuotePayloadSchema, jsonBody);
  if (!parsed.success) {
    return respondValidationError(c, parsed.issues);
  }

  const result = await getService(c).updateQuote(
    c,
    id,
    formData,
    parsed.output,
  );
  return c.json(result);
});

// ==========================================
// 5. 見積の削除
// ==========================================
quotesRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "見積削除",
    tags: ["quotes"],
    responses: { 200: { description: "削除成功" } },
  }),
  async (c) => {
  const id = c.req.param("id");
  const result = await getService(c).deleteQuote(c, id);
  return c.json(result);
});

// ==========================================
// Item4-e: 承認申請提出(DRAFT→PENDING_APPROVAL、承認機能OFF時は直接APPROVED)
// ==========================================
quotesRouter.post(
  "/:id/submit-for-approval",
  describeApiRoute({
    summary: "見積の承認申請",
    tags: ["quotes"],
    responses: {
      200: { description: "申請成功(または承認機能OFF時は直接確定)" },
      400: { description: "下書き状態でない、または承認フロー未定義等" },
      404: { description: "対象の見積が見つからない" },
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
});

// ==========================================
// Item4-e: 削除申請(DRAFT・未申請は直接削除、APPROVEDは削除承認申請)
// ==========================================
quotesRouter.post(
  "/:id/request-deletion",
  describeApiRoute({
    summary: "見積の削除申請(または未申請DRAFTの直接削除)",
    tags: ["quotes"],
    responses: {
      200: { description: "削除成功、または削除申請の申請成功" },
      400: { description: "承認処理中等、削除申請できない状態" },
      404: { description: "対象の見積が見つからない" },
    },
  }),
  async (c) => {
  const id = c.req.param("id");
  const result = await getService(c).requestQuoteDeletion(c, id);
  return c.json(result);
});

// ==========================================
// 8. PDF生成
// ==========================================
quotesRouter.post(
  "/:id/generate-pdf",
  describeApiRoute({
    summary: "見積書PDF生成",
    tags: ["quotes"],
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
});

// ==========================================
// 添付ファイルのストリーミング配信・ダウンロード
// ==========================================
quotesRouter.get(
  "/download/:id/:attachmentId",
  describeApiRoute({
    summary: "見積添付ファイル配信・ダウンロード",
    tags: ["quotes"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "R2上に実体ファイルが存在しない" },
    },
  }),
  async (c) => {
  const id = c.req.param("id");
  const attachmentId = c.req.param("attachmentId");

  const { attachment } = await getService(c).getDownloadStream(id, attachmentId);

  const fileObject = await c.env.QUATES_BUCKET.get(
    attachment.attachmentR2Path!,
  );
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
});

// ==========================================
// Item4-c: OTPダウンロード(外部公開エンドポイント。API_KEYチェック対象外、
// index.tsの許可リストに本ルートのパスパターンを明示的に追加している)
// ==========================================
quotesRouter.post(
  "/download-request/:id/:attachmentId",
  describeApiRoute({
    summary: "見積書ダウンロード用OTPの発行(外部公開)",
    tags: ["quotes"],
    json: RequestDownloadOtpSchema,
    responses: {
      200: { description: "OTP送信要求を受け付けた(登録済みメールの場合のみ実際に送信)" },
      400: { description: "バリデーションエラー" },
      404: { description: "対象の見積・添付ファイルが存在しない" },
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

quotesRouter.post(
  "/download-verify/:id/:attachmentId",
  describeApiRoute({
    summary: "見積書ダウンロード用OTPの検証・ファイル配信(外部公開)",
    tags: ["quotes"],
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

      const fileObject = await c.env.QUATES_BUCKET.get(
        attachment.attachmentR2Path!,
      );
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
// 9. 承認済見積書の一括メール配信リレー
// ==========================================
quotesRouter.post(
  "/bulk-send-email",
  describeApiRoute({
    summary: "承認済み見積書の一括メール送信",
    tags: ["quotes"],
    json: BulkSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "バリデーションエラー" },
      404: { description: "承認済みかつ有効な見積データが見つからない" },
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
});

// ==========================================
// 10. 個別見積書の単独メール配信
// ==========================================
quotesRouter.post(
  "/:id/send-email",
  describeApiRoute({
    summary: "個別見積書の個別メール送信",
    tags: ["quotes"],
    json: SingleSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "送信先メールアドレスの入力内容に不備" },
      404: { description: "承認済みかつ有効な見積データが見つからない" },
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
});

export { quotesRouter };
