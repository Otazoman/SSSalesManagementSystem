import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { ShipmentInstructionsRepository } from "./shipment-instructions.repository";
import { ShipmentInstructionsService } from "./shipment-instructions.service";
import { ShipmentInstructionPdfService } from "./shipment-instruction-pdf.service";
import { ShipmentInstructionDownloadService } from "./shipment-instruction-download.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { isHttpError } from "../../../platform/http/http-error";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeMutationRoute,
  describeListRoute,
  describeApiRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";
import {
  createShipmentInstructionSchema,
  GetShipmentInstructionsQuerySchema,
  VerifyInstructionDownloadOtpSchema,
  BulkGeneratePdfSchema,
} from "./shipment-instructions.schema";
import { resolveDocumentFileName } from "../../../platform/documents/document-file-name";

const shipmentInstructionsRouter = new Hono<{ Bindings: Env }>();

const getService = (c: any) =>
  new ShipmentInstructionsService(new ShipmentInstructionsRepository(c.env.DB));
const getPdfService = (c: any) =>
  new ShipmentInstructionPdfService(new ShipmentInstructionsRepository(c.env.DB));
const getDownloadService = (c: any) =>
  new ShipmentInstructionDownloadService(new ShipmentInstructionsRepository(c.env.DB));

// 出荷指示一覧 (GET /)
shipmentInstructionsRouter.get(
  "/",
  describeListRoute({
    summary: "出荷指示一覧取得",
    tags: ["shipment-instructions"],
    query: GetShipmentInstructionsQuerySchema,
    itemDescription: "出荷指示ヘッダー",
  }),
  async (c) => {
    try {
      const searchParams = v.parse(GetShipmentInstructionsQuerySchema, c.req.query());
      const params = parsePaginationParams(c.req.query());
      const service = getService(c);
      const sort = { sortBy: searchParams.sortBy, sortOrder: searchParams.sortOrder };
      const result = await service.listInstructions(searchParams, params, sort);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出荷指示一覧取得に失敗しました");
    }
  },
);

// 出荷指示データCSVダウンロード (GET /csv-download)
shipmentInstructionsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "出荷指示データCSVダウンロード", tags: ["shipment-instructions"] }),
  async (c) => {
    try {
      const searchParams = v.parse(GetShipmentInstructionsQuerySchema, c.req.query());
      const service = getService(c);
      const csvContent = await service.generateCsv(searchParams);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="shipment_instructions_export.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "CSV生成エラー");
    }
  },
);

// 出荷指示詳細 (GET /:id) : ヘッダー+明細
shipmentInstructionsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "出荷指示詳細取得",
    tags: ["shipment-instructions"],
    responses: {
      200: { description: "出荷指示ヘッダー+明細" },
      404: { description: "対象の出荷指示が見つからない" },
    },
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const service = getService(c);
      const result = await service.getInstructionDetail(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出荷指示詳細取得に失敗しました");
    }
  },
);

// 出荷指示作成 (POST /) : 承認機能ONなら承認申請、OFFなら即座に発行済みにする
shipmentInstructionsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "外部倉庫向け出荷指示の作成",
    tags: ["shipment-instructions"],
    json: createShipmentInstructionSchema,
    successDescription: "作成成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(createShipmentInstructionSchema, rawBody);

      const service = getService(c);
      const result = await service.createInstruction(c, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出荷指示の作成に失敗しました");
    }
  },
);

// 修正して再提出 (PUT /:id) : 差戻し済みの出荷指示を同じheaderIdのまま書き換えて再申請する
shipmentInstructionsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "出荷指示の修正・再申請",
    tags: ["shipment-instructions"],
    json: createShipmentInstructionSchema,
    successDescription: "再申請成功(承認機能ONの場合は承認を申請)",
    errors: [
      { status: 400, description: "入力データ検証エラー、または差戻し状態以外の対象" },
      { status: 404, description: "対象の出荷指示が見つからない" },
    ],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const rawBody = await c.req.json();
      const parsed = v.parse(createShipmentInstructionSchema, rawBody);

      const service = getService(c);
      const result = await service.resubmitInstruction(c, id, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出荷指示の修正・再申請に失敗しました");
    }
  },
);

// 取消 (POST /:id/cancel) : 発行済み(APPROVED/PARTIALLY_FULFILLED)・差戻し(REMANDED)の
// 出荷指示を取消す(UNAPPROVEDは対象外、承認履歴画面の既存「取り下げ」を使う)
shipmentInstructionsRouter.post(
  "/:id/cancel",
  describeMutationRoute({
    summary: "出荷指示の取消",
    tags: ["shipment-instructions"],
    successDescription: "取消成功",
    errors: [
      { status: 400, description: "取消できない状態の出荷指示" },
      { status: 404, description: "対象の出荷指示が見つからない" },
    ],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const result = await getService(c).cancelInstruction(c, id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出荷指示の取消に失敗しました");
    }
  },
);

// 指示書PDF生成 (POST /:id/generate-pdf) : 承認確定後(APPROVED以降)にオンデマンド生成する
shipmentInstructionsRouter.post(
  "/:id/generate-pdf",
  describeApiRoute({
    summary: "出荷指示書PDF生成",
    tags: ["shipment-instructions"],
    responses: {
      200: { description: "生成成功" },
      400: { description: "未発行の出荷指示" },
      404: { description: "対象データがない" },
    },
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const result = await getPdfService(c).generatePdf(c, id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "出荷指示書PDF生成に失敗しました");
    }
  },
);

// 複数指示書の一括PDF発行・送信 (POST /bulk-generate-pdf) : 単独発行(POST /:id/generate-pdf)を
// 選択された全IDに対して順に呼ぶだけの薄いラッパー。1件の失敗が他へ影響しないよう、
// 個別にtry/catchしてresults配列で成功/失敗を返す
shipmentInstructionsRouter.post(
  "/bulk-generate-pdf",
  describeMutationRoute({
    summary: "出荷指示書PDFの一括生成・送信",
    tags: ["shipment-instructions"],
    json: BulkGeneratePdfSchema,
    successDescription: "各IDごとの成功・失敗結果",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(BulkGeneratePdfSchema, rawBody);
      const pdfService = getPdfService(c);

      const results = [];
      for (const id of parsed.ids) {
        try {
          const result = await pdfService.generatePdf(c, id);
          results.push({ id, success: true, message: result.message });
        } catch (err) {
          results.push({
            id,
            success: false,
            message: isHttpError(err) ? err.message : "PDF生成に失敗しました",
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      return c.json({
        success: true,
        message: `${results.length}件中${successCount}件のPDFを生成・送信しました`,
        results,
      });
    } catch (err) {
      return respondError(c, err, "出荷指示書一括PDF生成に失敗しました");
    }
  },
);

// 最新の指示書PDFを表示・ダウンロード (GET /:id/document) : 社内向け(API_KEY必須の通常ルート)。
// attachmentIdを都度確認しなくても、発行済みであればヘッダーのinstructionDocumentR2Pathから
// 直接参照できるようにする(発行後にPDFを確認する手段が無かった問題への対応)
shipmentInstructionsRouter.get(
  "/:id/document",
  describeApiRoute({
    summary: "出荷指示書PDF表示・ダウンロード(社内向け、最新版)",
    tags: ["shipment-instructions"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "対象の出荷指示、またはPDFが未生成" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const repo = new ShipmentInstructionsRepository(c.env.DB);
    const header = await repo.findHeaderById(id);
    if (!header || !header.instructionDocumentR2Path) {
      return c.json({ success: false, message: "対象の指示書PDFが見つかりません" }, 404);
    }
    const fileObject = await c.env.SHIPMENT_INSTRUCTIONS_BUCKET.get(header.instructionDocumentR2Path);
    if (!fileObject) {
      return c.json({ success: false, message: "R2ストレージ上に実体ファイルが存在しません" }, 404);
    }
    return c.body(fileObject.body, 200, {
      "Content-Type": fileObject.httpMetadata?.contentType || "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(await resolveDocumentFileName(c.env.DB, "shipping_instruction", id))}`,
    });
  },
);

// 指示データCSVダウンロード(社内向け、OTP不要。1指示分のみ) (GET /:id/csv)
shipmentInstructionsRouter.get(
  "/:id/csv",
  describeCsvDownloadRoute({
    summary: "出荷指示データCSVダウンロード(社内向け、1指示分)",
    tags: ["shipment-instructions"],
  }),
  async (c) => {
    const id = c.req.param("id");
    try {
      const csvContent = await getService(c).generateCsvForInstruction(id);
      return c.body(csvContent, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="shipment_instruction_${id}.csv"`,
      });
    } catch (err) {
      return respondError(c, err, "CSV生成エラー");
    }
  },
);

// 添付ファイルのストリーミング配信(社内向け、API_KEY必須の通常ルート)
shipmentInstructionsRouter.get(
  "/download/:id/:attachmentId",
  describeApiRoute({
    summary: "出荷指示書PDF配信・ダウンロード(社内向け)",
    tags: ["shipment-instructions"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "R2上に実体ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");
    const repo = new ShipmentInstructionsRepository(c.env.DB);
    const attachment = await repo.findAttachmentByIdAndInstructionId(attachmentId, id);
    if (!attachment || !attachment.attachmentR2Path) {
      return c.json({ success: false, message: "指定されたファイルレコードが見つかりません" }, 404);
    }
    const fileObject = await c.env.SHIPMENT_INSTRUCTIONS_BUCKET.get(attachment.attachmentR2Path);
    if (!fileObject) {
      return c.json({ success: false, message: "R2ストレージ上に実体ファイルが存在しません" }, 404);
    }
    const encodedFileName = encodeURIComponent(attachment.fileName);
    return c.body(fileObject.body, 200, {
      "Content-Type": fileObject.httpMetadata?.contentType || "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodedFileName}`,
    });
  },
);

// ==========================================
// Item6 Phase6-4: OTPダウンロード(外部公開エンドポイント。API_KEYチェック対象外、
// index.tsの許可リストに本ルートのパスパターンを明示的に追加している)。
// 宛先メールアドレスは倉庫マスタ登録メールへ固定するため、見積と異なりemail入力は不要
// ==========================================
shipmentInstructionsRouter.post(
  "/download-request/:id/:attachmentId",
  describeApiRoute({
    summary: "出荷指示書ダウンロード用OTPの発行(外部公開)",
    tags: ["shipment-instructions"],
    responses: {
      200: { description: "OTP送信要求を受け付けた" },
      404: { description: "対象の出荷指示・添付ファイルが存在しない" },
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

shipmentInstructionsRouter.post(
  "/download-verify/:id/:attachmentId",
  describeApiRoute({
    summary: "出荷指示書ダウンロード用OTPの検証・ファイル配信(外部公開)",
    tags: ["shipment-instructions"],
    json: VerifyInstructionDownloadOtpSchema,
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
    const parsed = v.safeParse(VerifyInstructionDownloadOtpSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const { attachment, csv } = await getDownloadService(c).verifyDownloadOtp(
        c,
        id,
        attachmentId,
        parsed.output.otp,
      );

      const fileObject = await c.env.SHIPMENT_INSTRUCTIONS_BUCKET.get(attachment.attachmentR2Path!);
      if (!fileObject) {
        return c.json({ success: false, message: "R2ストレージ上に実体ファイルが存在しません" }, 404);
      }

      // PDFと指示データCSVの2ファイルを同時に返す必要があるため、単一バイナリではなく
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
        fileName: attachment.fileName,
        contentType: fileObject.httpMetadata?.contentType || "application/pdf",
        fileBase64,
        csv,
      });
    } catch (err) {
      return respondError(c, err);
    }
  },
);

export { shipmentInstructionsRouter };
