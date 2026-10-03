import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { PurchaseRecognitionRepository } from "./purchase-recognition.repository";
import { PurchaseRecognitionService } from "./purchase-recognition.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import { describeApiRoute, describeListRoute, describeCsvDownloadRoute } from "../../../platform/openapi/describe-route";
import {
  SearchPurchaseRecognitionsQuerySchema,
  PurchaseRecognitionPayloadSchema,
} from "./purchase-recognition.schema";
import { getWithFallback } from "../../../platform/r2/bucket-with-fallback";
import { todayJst } from "../../../platform/date/format-jst-date";

type Variables = {
  purchaseRecognitionService: PurchaseRecognitionService;
};

const purchaseRecognitionsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

purchaseRecognitionsRouter.use("*", async (c, next) => {
  const repo = new PurchaseRecognitionRepository(c.env.DB);
  c.set("purchaseRecognitionService", new PurchaseRecognitionService(repo));
  await next();
});

purchaseRecognitionsRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): PurchaseRecognitionService => c.get("purchaseRecognitionService");

// ==========================================
// 1. 検索機能付き一覧取得
// ==========================================
purchaseRecognitionsRouter.get(
  "/",
  describeListRoute({
    summary: "仕入一覧検索",
    tags: ["purchase-recognitions"],
    query: SearchPurchaseRecognitionsQuerySchema,
    itemDescription: "仕入(添付ファイル込み)",
  }),
  async (c) => {
    const queryParams = c.req.query();
    const parsed = v.safeParse(SearchPurchaseRecognitionsQuerySchema, queryParams);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const rawQuery = c.req.query();
    const sort = { sortBy: parsed.output.sortBy, sortOrder: parsed.output.sortOrder };
    if (rawQuery.page === undefined && rawQuery.limit === undefined) {
      const result = await getService(c).searchRecognitions(c, parsed.output, sort);
      return c.json(result);
    }
    const paginationParams = parsePaginationParams(rawQuery);
    const result = await getService(c).searchRecognitionsPage(
      c,
      parsed.output,
      paginationParams,
      sort,
    );
    return c.json(result);
  },
);

// ==========================================
// 2. CSVエクスポート
// ==========================================
purchaseRecognitionsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "仕入CSVダウンロード", tags: ["purchase-recognitions"] }),
  async (c) => {
    const csvContent = await getService(c).exportCsv(c);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="purchase_recognitions_export_${todayJst()}.csv"`,
    });
  },
);

// ==========================================
// 3. CSVインポート
// ==========================================
purchaseRecognitionsRouter.post(
  "/bulk-register",
  describeApiRoute({
    summary: "仕入CSVインポート",
    tags: ["purchase-recognitions"],
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
// 発注から選択(ピッカー)用: 発注明細ごとの残数量取得
// ==========================================
purchaseRecognitionsRouter.get(
  "/order-progress/:orderId",
  describeApiRoute({
    summary: "発注明細ごとの仕入残数量取得(発注から選択ピッカー用)",
    tags: ["purchase-recognitions"],
    responses: {
      200: { description: "発注明細ごとの残数量一覧" },
      404: { description: "対象の発注が見つからない" },
    },
  }),
  async (c) => {
    const orderId = c.req.param("orderId");
    const result = await getService(c).getOrderRecognitionProgress(c, orderId);
    return c.json(result);
  },
);

// ==========================================
// 4. 個別詳細取得
// ==========================================
purchaseRecognitionsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "仕入個別詳細取得",
    tags: ["purchase-recognitions"],
    responses: {
      200: { description: "仕入詳細" },
      404: { description: "対象の仕入が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const detail = await getService(c).getRecognitionDetail(c, id);
    if (!detail) {
      return c.json({ success: false, message: "対象の仕入が見つかりません" }, 404);
    }
    return c.json(detail);
  },
);

// ==========================================
// 5. 新規登録
// ==========================================
purchaseRecognitionsRouter.post(
  "/register",
  describeApiRoute({
    summary: "仕入新規登録",
    tags: ["purchase-recognitions"],
    responses: {
      200: { description: "登録成功" },
      400: { description: "recognitionData未送信、JSON不正、またはバリデーションエラー" },
    },
  }),
  async (c) => {
    const formData = await c.req.formData();
    const dataStr = formData.get("recognitionData") as string;
    if (!dataStr) {
      return c.json(
        { success: false, message: "仕入データ(recognitionData)が送信されていません" },
        400,
      );
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(dataStr);
    } catch {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(PurchaseRecognitionPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).createRecognition(c, formData, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 6. 修正
// ==========================================
purchaseRecognitionsRouter.put(
  "/:id",
  describeApiRoute({
    summary: "仕入修正",
    tags: ["purchase-recognitions"],
    responses: {
      200: { description: "更新成功" },
      400: { description: "修正データ未送信、JSON不正、またはバリデーションエラー" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const formData = await c.req.formData();
    const dataStr = formData.get("recognitionData") as string;
    if (!dataStr) {
      return c.json({ success: false, message: "修正データが見つかりません" }, 400);
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(dataStr);
    } catch {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(PurchaseRecognitionPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).updateRecognition(c, id, formData, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 7. 削除
// ==========================================
purchaseRecognitionsRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "仕入削除",
    tags: ["purchase-recognitions"],
    responses: { 200: { description: "削除成功" } },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).deleteRecognition(c, id);
    return c.json(result);
  },
);

// ==========================================
// 8. 承認申請提出
// ==========================================
purchaseRecognitionsRouter.post(
  "/:id/submit-for-approval",
  describeApiRoute({
    summary: "仕入の承認申請",
    tags: ["purchase-recognitions"],
    responses: {
      200: { description: "申請成功(または承認機能OFF時は直接確定)" },
      400: { description: "下書き状態でない、または承認フロー未定義等" },
      404: { description: "対象の仕入が見つからない" },
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
purchaseRecognitionsRouter.post(
  "/:id/request-deletion",
  describeApiRoute({
    summary: "仕入の削除申請(または未申請DRAFTの直接削除)",
    tags: ["purchase-recognitions"],
    responses: {
      200: { description: "削除成功、または削除申請の申請成功" },
      400: { description: "承認処理中等、削除申請できない状態" },
      404: { description: "対象の仕入が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).requestRecognitionDeletion(c, id);
    return c.json(result);
  },
);

// ==========================================
// 10. PDF生成
// ==========================================
purchaseRecognitionsRouter.post(
  "/:id/generate-pdf",
  describeApiRoute({
    summary: "仕入計上書PDF生成",
    tags: ["purchase-recognitions"],
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
purchaseRecognitionsRouter.get(
  "/download/:id/:attachmentId",
  describeApiRoute({
    summary: "仕入添付ファイル配信・ダウンロード",
    tags: ["purchase-recognitions"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "R2上に実体ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");

    const { attachment } = await getService(c).getDownloadStream(id, attachmentId);

    const fileObject = await getWithFallback({ primary: c.env.PURCHASE_RECOGNITIONS_BUCKET, legacy: c.env.QUATES_BUCKET }, attachment.attachmentR2Path!);
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

export { purchaseRecognitionsRouter };
