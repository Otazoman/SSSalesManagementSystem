import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { PurchaseOrderRepository } from "./purchase-order.repository";
import { PurchaseOrderService } from "./purchase-order.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeListRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";
import {
  SearchOrdersQuerySchema,
  PurchaseOrderPayloadSchema,
  BulkSendEmailSchema,
  SingleSendEmailSchema,
  RequestDownloadOtpSchema,
  VerifyDownloadOtpSchema,
} from "./purchase-order.schema";
import { todayJst } from "../../../platform/date/format-jst-date";

type Variables = {
  purchaseOrderService: PurchaseOrderService;
};

const purchaseOrdersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

purchaseOrdersRouter.use("*", async (c, next) => {
  const repo = new PurchaseOrderRepository(c.env.DB);
  c.set("purchaseOrderService", new PurchaseOrderService(repo, c.env.DB));
  await next();
});

purchaseOrdersRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): PurchaseOrderService => c.get("purchaseOrderService");

// ==========================================
// 一覧検索
// ==========================================
purchaseOrdersRouter.get(
  "/",
  describeListRoute({
    summary: "発注一覧検索",
    tags: ["purchase-orders"],
    query: SearchOrdersQuerySchema,
    itemDescription: "発注(添付ファイル込み)",
  }),
  async (c) => {
    const queryParams = c.req.query();
    const parsed = v.safeParse(SearchOrdersQuerySchema, queryParams);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const rawQuery = c.req.query();
    const sort = { sortBy: parsed.output.sortBy, sortOrder: parsed.output.sortOrder };
    if (rawQuery.page === undefined && rawQuery.limit === undefined) {
      const result = await getService(c).searchOrders(c, parsed.output, sort);
      return c.json(result);
    }
    const paginationParams = parsePaginationParams(rawQuery);
    const result = await getService(c).searchOrdersPage(c, parsed.output, paginationParams, sort);
    return c.json(result);
  },
);

// ==========================================
// CSVエクスポート
// ==========================================
purchaseOrdersRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "発注CSVダウンロード", tags: ["purchase-orders"] }),
  async (c) => {
    const csvContent = await getService(c).exportCsv(c);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="purchase_orders_export_${todayJst()}.csv"`,
    });
  },
);

// ==========================================
// CSVインポート
// ==========================================
purchaseOrdersRouter.post(
  "/bulk-register",
  describeApiRoute({
    summary: "発注CSVインポート",
    tags: ["purchase-orders"],
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
// 個別詳細取得
// ==========================================
purchaseOrdersRouter.get(
  "/:id",
  describeApiRoute({
    summary: "発注個別詳細取得",
    tags: ["purchase-orders"],
    responses: {
      200: { description: "発注詳細" },
      404: { description: "対象の発注が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const detail = await getService(c).getOrderDetail(c, id);
    if (!detail) {
      return c.json({ success: false, message: "対象の発注が見つかりません" }, 404);
    }
    return c.json(detail);
  },
);

// ==========================================
// 新規登録
// ==========================================
purchaseOrdersRouter.post(
  "/register",
  describeApiRoute({
    summary: "発注新規登録",
    tags: ["purchase-orders"],
    responses: {
      200: { description: "登録成功" },
      400: { description: "orderData未送信、JSON不正、またはバリデーションエラー" },
    },
  }),
  async (c) => {
    const formData = await c.req.formData();
    const dataStr = formData.get("orderData") as string;
    if (!dataStr) {
      return c.json(
        { success: false, message: "発注データ(orderData)が送信されていません" },
        400,
      );
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(dataStr);
    } catch (e) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(PurchaseOrderPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).createOrder(c, formData, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 修正
// ==========================================
purchaseOrdersRouter.put(
  "/:id",
  describeApiRoute({
    summary: "発注修正",
    tags: ["purchase-orders"],
    responses: {
      200: { description: "更新成功" },
      400: { description: "修正データ未送信、JSON不正、またはバリデーションエラー" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const formData = await c.req.formData();
    const dataStr = formData.get("orderData") as string;
    if (!dataStr) {
      return c.json({ success: false, message: "修正データが見つかりません" }, 400);
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(dataStr);
    } catch {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(PurchaseOrderPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).updateOrder(c, id, formData, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 削除
// ==========================================
purchaseOrdersRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "発注削除",
    tags: ["purchase-orders"],
    responses: { 200: { description: "削除成功" } },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).deleteOrder(c, id);
    return c.json(result);
  },
);

// ==========================================
// 承認申請提出
// ==========================================
purchaseOrdersRouter.post(
  "/:id/submit-for-approval",
  describeApiRoute({
    summary: "発注の承認申請",
    tags: ["purchase-orders"],
    responses: {
      200: { description: "申請成功(または承認機能OFF時は直接確定)" },
      400: { description: "下書き状態でない、または承認フロー未定義等" },
      404: { description: "対象の発注が見つからない" },
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
// 削除申請(または未申請DRAFTの直接削除)
// ==========================================
purchaseOrdersRouter.post(
  "/:id/request-deletion",
  describeApiRoute({
    summary: "発注の削除申請(または未申請DRAFTの直接削除)",
    tags: ["purchase-orders"],
    responses: {
      200: { description: "削除成功、または削除申請の申請成功" },
      400: { description: "承認処理中等、削除申請できない状態" },
      404: { description: "対象の発注が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).requestOrderDeletion(c, id);
    return c.json(result);
  },
);

// ==========================================
// 発注→入荷の消込連携: 明細ごとの入荷進捗(発注数量/入荷済/残数量)
// ==========================================
purchaseOrdersRouter.get(
  "/:id/receipt-progress",
  describeApiRoute({
    summary: "発注明細ごとの入荷進捗取得",
    tags: ["purchase-orders"],
    responses: {
      200: { description: "進捗一覧" },
      404: { description: "対象の発注が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    try {
      const result = await getService(c).getReceiptProgress(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// ==========================================
// PDF生成
// ==========================================
purchaseOrdersRouter.post(
  "/:id/generate-pdf",
  describeApiRoute({
    summary: "発注書PDF生成",
    tags: ["purchase-orders"],
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
// 添付ファイルのストリーミング配信・ダウンロード(社内向け、OTP認証なし)
// ==========================================
purchaseOrdersRouter.get(
  "/download/:id/:attachmentId",
  describeApiRoute({
    summary: "発注添付ファイル配信・ダウンロード",
    tags: ["purchase-orders"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "R2上に実体ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");

    const { attachment } = await getService(c).getDownloadStream(id, attachmentId);

    const fileObject = await c.env.PURCHASE_ORDERS_BUCKET.get(attachment.attachmentR2Path!);
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
  },
);

// ==========================================
// OTPダウンロード(外部公開エンドポイント。API_KEYチェック対象外、
// index.tsの許可リストに本ルートのパスパターンを明示的に追加済み)
// ==========================================
purchaseOrdersRouter.post(
  "/download-request/:id/:attachmentId",
  describeApiRoute({
    summary: "発注書ダウンロード用OTPの発行(外部公開)",
    tags: ["purchase-orders"],
    json: RequestDownloadOtpSchema,
    responses: {
      200: { description: "OTP送信要求を受け付けた(登録済みメールの場合のみ実際に送信)" },
      400: { description: "バリデーションエラー" },
      404: { description: "対象の発注・添付ファイルが存在しない" },
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
      const result = await getService(c).requestDownloadOtp(c, id, attachmentId, parsed.output.email);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

purchaseOrdersRouter.post(
  "/download-verify/:id/:attachmentId",
  describeApiRoute({
    summary: "発注書ダウンロード用OTPの検証・ファイル配信(外部公開)",
    tags: ["purchase-orders"],
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

      const fileObject = await c.env.PURCHASE_ORDERS_BUCKET.get(attachment.attachmentR2Path!);
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
// 承認済発注書の一括メール配信
// ==========================================
purchaseOrdersRouter.post(
  "/bulk-send-email",
  describeApiRoute({
    summary: "承認済み発注書の一括メール送信",
    tags: ["purchase-orders"],
    json: BulkSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "バリデーションエラー" },
      404: { description: "承認済みかつ有効な発注データが見つからない" },
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
// 個別発注書の単独メール配信
// ==========================================
purchaseOrdersRouter.post(
  "/:id/send-email",
  describeApiRoute({
    summary: "個別発注書の個別メール送信",
    tags: ["purchase-orders"],
    json: SingleSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "送信先メールアドレスの入力内容に不備" },
      404: { description: "承認済みかつ有効な発注データが見つからない" },
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

export { purchaseOrdersRouter };
