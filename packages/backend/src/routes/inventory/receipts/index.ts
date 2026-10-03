import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { ReceiptsRepository } from "./receipts.repository";
import { ReceiptsService } from "./receipts.service";
import { AcceptanceInspectionPdfService } from "./acceptance-inspection-pdf.service";
import { AcceptanceInspectionDownloadService } from "./acceptance-inspection-download.service";
import { AcceptanceInspectionMailService } from "./acceptance-inspection-mail.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeMutationRoute,
  describeListRoute,
  describeApiRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  createReceiptSchema,
  GetReceiptsQuerySchema,
  bulkRegisterReceiptSchema,
  RequestAcceptanceInspectionDownloadOtpSchema,
  VerifyAcceptanceInspectionDownloadOtpSchema,
  BulkSendAcceptanceInspectionEmailSchema,
  SingleSendAcceptanceInspectionEmailSchema,
} from "./receipts.schema";
import { getWithFallback } from "../../../platform/r2/bucket-with-fallback";

const stockReceiptsRouter = new Hono<{ Bindings: Env }>();

const getService = (c: any) => new ReceiptsService(new ReceiptsRepository(c.env.DB));
const getPdfService = (c: any) => new AcceptanceInspectionPdfService(new ReceiptsRepository(c.env.DB));
const getDownloadService = (c: any) =>
  new AcceptanceInspectionDownloadService(new ReceiptsRepository(c.env.DB));
const getMailService = (c: any) =>
  new AcceptanceInspectionMailService(new ReceiptsRepository(c.env.DB), getPdfService(c));

// 入庫履歴一覧 (GET /)
stockReceiptsRouter.get(
  "/",
  describeListRoute({
    summary: "入庫履歴一覧取得",
    tags: ["stock-receipts"],
    query: GetReceiptsQuerySchema,
    itemDescription: "入庫ヘッダー",
  }),
  async (c) => {
    try {
      const searchParams = v.parse(GetReceiptsQuerySchema, c.req.query());
      const params = parsePaginationParams(c.req.query());
      const service = getService(c);
      const sort = { sortBy: searchParams.sortBy, sortOrder: searchParams.sortOrder };
      const result = await service.listReceipts(searchParams, params, sort);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "入庫履歴一覧取得に失敗しました");
    }
  },
);

// 入庫履歴CSVダウンロード (GET /csv-download)
stockReceiptsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "入庫履歴CSVダウンロード", tags: ["stock-receipts"] }),
  async (c) => {
    try {
      const searchParams = v.parse(GetReceiptsQuerySchema, c.req.query());
      const service = getService(c);
      const csvContent = await service.generateCsv(searchParams);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="stock_receipts_export.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "CSV生成エラー");
    }
  },
);

// 入庫CSV一括登録 (POST /bulk-register) : 1ファイル=1入庫として登録する
stockReceiptsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "入庫CSVインポート",
    tags: ["stock-receipts"],
    successDescription: "登録成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(bulkRegisterReceiptSchema, rawBody);

      const service = getService(c);
      const result = await service.bulkImportCsv(c, parsed.csvData);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "CSVインポートに失敗しました");
    }
  },
);

// 入庫詳細 (GET /:id) : ヘッダー+明細
stockReceiptsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "入庫詳細取得",
    tags: ["stock-receipts"],
    responses: {
      200: { description: "入庫ヘッダー+明細" },
      404: { description: "対象の入庫が見つからない" },
    },
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const service = getService(c);
      const result = await service.getReceiptDetail(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "入庫詳細取得に失敗しました");
    }
  },
);

// 入庫確定 (POST /) : ロケーション×商品を確定し、承認機能ONなら承認申請、OFFなら即座に在庫反映する
stockReceiptsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "自社倉庫の入庫確定",
    tags: ["stock-receipts"],
    json: createReceiptSchema,
    successDescription: "入庫確定成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(createReceiptSchema, rawBody);

      const service = getService(c);
      const result = await service.createReceipt(c, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "入庫確定に失敗しました");
    }
  },
);

// 修正して再提出 (PUT /:id) : 差戻し済みの入庫を同じheaderIdのまま書き換えて再申請する
stockReceiptsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "入庫の修正・再申請",
    tags: ["stock-receipts"],
    json: createReceiptSchema,
    successDescription: "再申請成功(承認機能ONの場合は承認を申請)",
    errors: [
      { status: 400, description: "入力データ検証エラー、または差戻し状態以外の対象" },
      { status: 404, description: "対象の入庫が見つからない" },
    ],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const rawBody = await c.req.json();
      const parsed = v.parse(createReceiptSchema, rawBody);

      const service = getService(c);
      const result = await service.resubmitReceipt(c, id, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "入庫の修正・再申請に失敗しました");
    }
  },
);

// ==========================================
// 検収書発行(Item9、発注書と同じ方式): PDF生成
// ==========================================
stockReceiptsRouter.post(
  "/:id/generate-pdf",
  describeApiRoute({
    summary: "検収書PDF生成",
    tags: ["stock-receipts"],
    responses: {
      200: { description: "生成成功" },
      404: { description: "対象データがない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    try {
      const result = await getPdfService(c).generatePdf(c, id);
      if (!result) {
        return c.json({ success: false, message: "対象データがありません" }, 404);
      }
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// ==========================================
// 検収書添付ファイルのストリーミング配信・ダウンロード(社内向け、OTP認証なし)
// ==========================================
stockReceiptsRouter.get(
  "/download/:id/:attachmentId",
  describeApiRoute({
    summary: "検収書添付ファイル配信・ダウンロード",
    tags: ["stock-receipts"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "R2上に実体ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");

    try {
      const { attachment } = await getDownloadService(c).getDownloadStream(id, attachmentId);

      const fileObject = await getWithFallback({ primary: c.env.ACCEPTANCE_INSPECTIONS_BUCKET, legacy: c.env.SYSTEM_BUCKET }, attachment.attachmentR2Path!);
      if (!fileObject) {
        return c.json({ success: false, message: "R2ストレージ上に実体ファイルが存在しません" }, 404);
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
// 検収書OTPダウンロード(外部公開エンドポイント。API_KEYチェック対象外、
// src/index.tsの許可リストに本ルートのパスパターンを明示的に追加している)
// ==========================================
stockReceiptsRouter.post(
  "/download-request/:id/:attachmentId",
  describeApiRoute({
    summary: "検収書ダウンロード用OTPの発行(外部公開)",
    tags: ["stock-receipts"],
    json: RequestAcceptanceInspectionDownloadOtpSchema,
    responses: {
      200: { description: "OTP送信要求を受け付けた(登録済みメールの場合のみ実際に送信)" },
      400: { description: "バリデーションエラー" },
      404: { description: "対象の入庫・添付ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");
    const body = await c.req.json();
    const parsed = v.safeParse(RequestAcceptanceInspectionDownloadOtpSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const result = await getDownloadService(c).requestDownloadOtp(c, id, attachmentId, parsed.output.email);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

stockReceiptsRouter.post(
  "/download-verify/:id/:attachmentId",
  describeApiRoute({
    summary: "検収書ダウンロード用OTPの検証・ファイル配信(外部公開)",
    tags: ["stock-receipts"],
    json: VerifyAcceptanceInspectionDownloadOtpSchema,
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
    const parsed = v.safeParse(VerifyAcceptanceInspectionDownloadOtpSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const { attachment } = await getDownloadService(c).verifyDownloadOtp(
        c,
        id,
        attachmentId,
        parsed.output.email,
        parsed.output.otp,
      );

      const fileObject = await getWithFallback({ primary: c.env.ACCEPTANCE_INSPECTIONS_BUCKET, legacy: c.env.SYSTEM_BUCKET }, attachment.attachmentR2Path!);
      if (!fileObject) {
        return c.json({ success: false, message: "R2ストレージ上に実体ファイルが存在しません" }, 404);
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
// 承認済検収書(入庫)の一括メール配信
// ==========================================
stockReceiptsRouter.post(
  "/bulk-send-email",
  describeApiRoute({
    summary: "承認済み入庫(検収書)の一括メール送信",
    tags: ["stock-receipts"],
    json: BulkSendAcceptanceInspectionEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "バリデーションエラー" },
      404: { description: "承認済みかつ有効な入庫データが見つからない" },
    },
  }),
  async (c) => {
    const body = await c.req.json();
    const parsed = v.safeParse(BulkSendAcceptanceInspectionEmailSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const result = await getMailService(c).bulkSendEmail(c, parsed.output);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// ==========================================
// 個別検収書(入庫)の単独メール配信
// ==========================================
stockReceiptsRouter.post(
  "/:id/send-email",
  describeApiRoute({
    summary: "個別入庫(検収書)の個別メール送信",
    tags: ["stock-receipts"],
    json: SingleSendAcceptanceInspectionEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "送信先メールアドレスの入力内容に不備" },
      404: { description: "承認済みかつ有効な入庫データが見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = v.safeParse(SingleSendAcceptanceInspectionEmailSchema, body);

    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const result = await getMailService(c).singleSendEmail(c, id, parsed.output);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

export { stockReceiptsRouter };
