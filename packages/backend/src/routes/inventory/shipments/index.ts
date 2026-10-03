import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { ShipmentsRepository } from "./shipments.repository";
import { ShipmentsService } from "./shipments.service";
import { DeliveryNoteDownloadService } from "./delivery-note-download.service";
import { DeliveryNoteMailService } from "./delivery-note-mail.service";
import { DeliveryNotePdfService } from "./delivery-note-pdf.service";
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
  createShipmentSchema,
  GetShipmentsQuerySchema,
  bulkRegisterShipmentSchema,
  VerifyDeliveryNoteDownloadOtpSchema,
  BulkSendDeliveryNoteEmailSchema,
  SingleSendDeliveryNoteEmailSchema,
} from "./shipments.schema";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";
import { getWithFallback } from "../../../platform/r2/bucket-with-fallback";

const stockShipmentsRouter = new Hono<{ Bindings: Env }>();

const getService = (c: any) => new ShipmentsService(new ShipmentsRepository(c.env.DB));
const getDownloadService = (c: any) => new DeliveryNoteDownloadService(new ShipmentsRepository(c.env.DB));
const getMailService = (c: any) => new DeliveryNoteMailService(new ShipmentsRepository(c.env.DB));

// 出庫履歴一覧 (GET /)
stockShipmentsRouter.get(
  "/",
  describeListRoute({
    summary: "出庫履歴一覧取得",
    tags: ["stock-shipments"],
    query: GetShipmentsQuerySchema,
    itemDescription: "出庫ヘッダー",
  }),
  async (c) => {
    try {
      const searchParams = v.parse(GetShipmentsQuerySchema, c.req.query());
      const params = parsePaginationParams(c.req.query());
      const service = getService(c);
      const sort = { sortBy: searchParams.sortBy, sortOrder: searchParams.sortOrder };
      const result = await service.listShipments(searchParams, params, sort);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出庫履歴一覧取得に失敗しました");
    }
  },
);

// 出庫履歴CSVダウンロード (GET /csv-download)
stockShipmentsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "出庫履歴CSVダウンロード", tags: ["stock-shipments"] }),
  async (c) => {
    try {
      const searchParams = v.parse(GetShipmentsQuerySchema, c.req.query());
      const service = getService(c);
      const csvContent = await service.generateCsv(searchParams);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="stock_shipments_export.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "CSV生成エラー");
    }
  },
);

// 出庫CSV一括登録 (POST /bulk-register) : 1ファイル=1出庫として登録する
stockShipmentsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "出庫CSVインポート",
    tags: ["stock-shipments"],
    successDescription: "登録成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(bulkRegisterShipmentSchema, rawBody);

      const service = getService(c);
      const result = await service.bulkImportCsv(c, parsed.csvData);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "CSVインポートに失敗しました");
    }
  },
);

// 出庫詳細 (GET /:id) : ヘッダー+明細
stockShipmentsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "出庫詳細取得",
    tags: ["stock-shipments"],
    responses: {
      200: { description: "出庫ヘッダー+明細" },
      404: { description: "対象の出庫が見つからない" },
    },
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const service = getService(c);
      const result = await service.getShipmentDetail(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出庫詳細取得に失敗しました");
    }
  },
);

// 出庫確定 (POST /) : ロケーション指定のみから紐付け品目を自動特定し、承認機能ONなら承認申請、OFFなら即座に在庫反映する
stockShipmentsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "自社倉庫の出庫確定",
    tags: ["stock-shipments"],
    json: createShipmentSchema,
    successDescription: "出庫確定成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(createShipmentSchema, rawBody);

      const service = getService(c);
      const result = await service.createShipment(c, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出庫確定に失敗しました");
    }
  },
);

// 修正して再提出 (PUT /:id) : 差戻し済みの出庫を同じheaderIdのまま書き換えて再申請する
stockShipmentsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "出庫の修正・再申請",
    tags: ["stock-shipments"],
    json: createShipmentSchema,
    successDescription: "再申請成功(承認機能ONの場合は承認を申請)",
    errors: [
      { status: 400, description: "入力データ検証エラー、または差戻し状態以外の対象" },
      { status: 404, description: "対象の出庫が見つからない" },
    ],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const rawBody = await c.req.json();
      const parsed = v.parse(createShipmentSchema, rawBody);

      const service = getService(c);
      const result = await service.resubmitShipment(c, id, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出庫の修正・再申請に失敗しました");
    }
  },
);

// 納品書PDFダウンロード (GET /:id/delivery-note) : 得意先設定済み・出庫確定済みの場合のみ
// 自動生成されている(社内向け、API_KEY必須の通常ルート。得意先向けのOTP配布は
// 下記の/download-request・/download-verifyで別途提供する)
stockShipmentsRouter.get(
  "/:id/delivery-note",
  describeApiRoute({
    summary: "納品書PDFダウンロード",
    tags: ["stock-shipments"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "対象の出庫、または納品書PDFが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const repo = new ShipmentsRepository(c.env.DB);
    const header = await repo.findHeaderById(id);
    if (!header || !header.deliveryNoteR2Path) {
      return c.json({ success: false, message: "対象の納品書PDFが見つかりません" }, 404);
    }
    const fileObject = await getWithFallback(
      { primary: c.env.DELIVERY_NOTES_BUCKET, legacy: c.env.SYSTEM_BUCKET },
      header.deliveryNoteR2Path,
    );
    if (!fileObject) {
      return c.json({ success: false, message: "R2ストレージ上に実体ファイルが存在しません" }, 404);
    }
    return c.body(fileObject.body, 200, {
      "Content-Type": fileObject.httpMetadata?.contentType || "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(await resolveDocumentFileName(c.env.DB, "sales_invoice", id))}`,
    });
  },
);

// BUG-030: 納品書PDFの作成(作り直し)。承認時の自動作成に失敗した場合や、内容を直した後に使う。
// 他の帳票の POST /:id/generate-pdf と同じ形。対象は出庫確定済み(APPROVED)の出庫のみ
stockShipmentsRouter.post(
  "/:id/generate-pdf",
  describeApiRoute({
    summary: "納品書PDF作成(作り直し)",
    tags: ["stock-shipments"],
    responses: {
      200: { description: "作成成功" },
      400: { description: "得意先が未設定・明細が無い・出庫が未確定など、作成できない" },
      404: { description: "対象の出庫が無い" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    try {
      const repo = new ShipmentsRepository(c.env.DB);
      const header = await repo.findHeaderById(id);
      if (!header) return c.json({ success: false, message: "対象の出庫が見つかりません" }, 404);
      if (header.status !== "APPROVED") {
        return c.json({ success: false, message: "出庫が確定(承認済み)していないため、納品書を作成できません" }, 400);
      }
      return c.json(await new DeliveryNotePdfService(repo).generatePdf(c, id));
    } catch (err) {
      return respondError(c, err, "納品書PDFの作成に失敗しました");
    }
  },
);

// 納品予定データCSVダウンロード (GET /:id/delivery-schedule-csv) : 出庫確定済み(APPROVED)かつ
// 得意先設定済みの場合のみ出力可能
stockShipmentsRouter.get(
  "/:id/delivery-schedule-csv",
  describeApiRoute({
    summary: "納品予定データCSVダウンロード",
    tags: ["stock-shipments"],
    responses: {
      200: { description: "CSV本体" },
      400: { description: "未確定、または得意先未設定の出庫" },
      404: { description: "対象の出庫が見つからない" },
    },
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const service = getService(c);
      const csvContent = await service.generateDeliveryScheduleCsv(c, id);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="delivery_schedule_${id}.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "納品予定データCSV生成に失敗しました");
    }
  },
);

// ==========================================
// Item7残課題7: 納品書OTPダウンロード(外部公開エンドポイント。API_KEYチェック対象外、
// proxy.tsの許可リストに本ルートのパスパターンを明示的に追加している)。
// 出荷指示書と同じく宛先メールアドレスは得意先の登録済み連絡先へ固定するため、
// 見積と異なりメールアドレス入力ステップは不要。shipmentHeaderIdをdocumentId/attachmentId
// 両方に使い回す(納品書には複数バージョン管理の概念が無いため専用の添付テーブルを持たない)
// ==========================================
stockShipmentsRouter.post(
  "/download-request/:id/:attachmentId",
  describeApiRoute({
    summary: "納品書ダウンロード用OTPの発行(外部公開)",
    tags: ["stock-shipments"],
    responses: {
      200: { description: "OTP送信要求を受け付けた" },
      404: { description: "対象の出庫、または納品書PDFが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");
    try {
      const result = await getDownloadService(c).requestDownloadOtp(c, id, attachmentId);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

stockShipmentsRouter.post(
  "/download-verify/:id/:attachmentId",
  describeApiRoute({
    summary: "納品書ダウンロード用OTPの検証・ファイル配信(外部公開)",
    tags: ["stock-shipments"],
    json: VerifyDeliveryNoteDownloadOtpSchema,
    responses: {
      200: { description: "ファイル本体(PDF base64 + CSV)" },
      400: { description: "OTPが不正・期限切れ・試行回数超過" },
      404: { description: "対象ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");
    const body = await c.req.json();
    const parsed = v.safeParse(VerifyDeliveryNoteDownloadOtpSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const { r2Path, fileName, csv } = await getDownloadService(c).verifyDownloadOtp(
        c,
        id,
        attachmentId,
        parsed.output.otp,
      );

      const fileObject = await getWithFallback({ primary: c.env.DELIVERY_NOTES_BUCKET, legacy: c.env.SYSTEM_BUCKET }, r2Path);
      if (!fileObject) {
        return c.json({ success: false, message: "R2ストレージ上に実体ファイルが存在しません" }, 404);
      }

      // PDFと納品予定データCSVの2ファイルを同時に返す必要があるため、単一バイナリではなく
      // JSON(PDFはbase64化)で返す。フロント側(use-instruction-download.ts)がこの形式に対応
      const fileBuffer = await fileObject.arrayBuffer();
      const uint8Array = new Uint8Array(fileBuffer);
      let binaryString = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        binaryString += String.fromCharCode.apply(
          null,
          uint8Array.subarray(i, i + chunkSize) as unknown as number[],
        );
      }
      const fileBase64 = btoa(binaryString);

      return c.json({
        success: true,
        fileName,
        contentType: fileObject.httpMetadata?.contentType || "application/pdf",
        fileBase64,
        csv,
      });
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// ==========================================
// 納品書メール送信(方式A): 一括送信
// ==========================================
stockShipmentsRouter.post(
  "/bulk-send-email",
  describeApiRoute({
    summary: "承認済み出庫(納品書)の一括メール送信",
    tags: ["stock-shipments"],
    json: BulkSendDeliveryNoteEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "バリデーションエラー" },
      404: { description: "承認済みかつ有効な出庫データが見つからない" },
    },
  }),
  async (c) => {
    const body = await c.req.json();
    const parsed = v.safeParse(BulkSendDeliveryNoteEmailSchema, body);
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
// 納品書メール送信(方式A): 個別送信
// ==========================================
stockShipmentsRouter.post(
  "/:id/send-email",
  describeApiRoute({
    summary: "個別出庫(納品書)の個別メール送信",
    tags: ["stock-shipments"],
    json: SingleSendDeliveryNoteEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "送信先メールアドレスの入力内容に不備" },
      404: { description: "承認済みかつ有効な出庫データが見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = v.safeParse(SingleSendDeliveryNoteEmailSchema, body);

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

export { stockShipmentsRouter };
