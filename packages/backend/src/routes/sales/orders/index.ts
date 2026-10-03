import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { SalesOrderRepository } from "./sales-order.repository";
import { SalesOrderService } from "./sales-order.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeListRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";
import {
  SearchOrdersQuerySchema,
  SalesOrderPayloadSchema,
  BulkSendEmailSchema,
  BulkShipmentPlanSchema,
  SingleSendEmailSchema,
  RequestDownloadOtpSchema,
  VerifyDownloadOtpSchema,
} from "./sales-order.schema";
import { getWithFallback } from "../../../platform/r2/bucket-with-fallback";
import { todayJst } from "../../../platform/date/format-jst-date";

type Variables = {
  salesOrderService: SalesOrderService;
};

const salesOrdersRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

salesOrdersRouter.use("*", async (c, next) => {
  const repo = new SalesOrderRepository(c.env.DB);
  c.set("salesOrderService", new SalesOrderService(repo));
  await next();
});

salesOrdersRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): SalesOrderService => c.get("salesOrderService");

// ==========================================
// 一覧検索
// ==========================================
salesOrdersRouter.get(
  "/",
  describeListRoute({
    summary: "受注一覧検索",
    tags: ["sales-orders"],
    query: SearchOrdersQuerySchema,
    itemDescription: "受注(添付ファイル込み)",
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
salesOrdersRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "受注CSVダウンロード", tags: ["sales-orders"] }),
  async (c) => {
    const csvContent = await getService(c).exportCsv(c);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales_orders_export_${todayJst()}.csv"`,
    });
  },
);

// ==========================================
// CSVインポート
// ==========================================
salesOrdersRouter.post(
  "/bulk-register",
  describeApiRoute({
    summary: "受注CSVインポート",
    tags: ["sales-orders"],
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
// 欠品自動提案①(受注紐付け方式): 承認済み受注を横断した欠品明細のフラット一覧
// ==========================================
salesOrdersRouter.get(
  "/backordered-items",
  describeApiRoute({
    summary: "承認済み受注の欠品(引当不足)明細一覧(受注横断)",
    tags: ["sales-orders"],
    responses: {
      200: { description: "欠品明細一覧" },
    },
  }),
  async (c) => {
    const result = await getService(c).getBackorderedItems(c);
    return c.json(result);
  },
);

// ==========================================
// 個別詳細取得
// ==========================================
salesOrdersRouter.get(
  "/:id",
  describeApiRoute({
    summary: "受注個別詳細取得",
    tags: ["sales-orders"],
    responses: {
      200: { description: "受注詳細" },
      404: { description: "対象の受注が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const detail = await getService(c).getOrderDetail(c, id);
    if (!detail) {
      return c.json({ success: false, message: "対象の受注が見つかりません" }, 404);
    }
    return c.json(detail);
  },
);

// ==========================================
// 新規登録
// ==========================================
salesOrdersRouter.post(
  "/register",
  describeApiRoute({
    summary: "受注新規登録",
    tags: ["sales-orders"],
    responses: {
      200: { description: "登録成功" },
      400: { description: "orderData未送信、JSON不正、またはバリデーションエラー(SalesOrderPayloadSchema)" },
    },
  }),
  async (c) => {
    const formData = await c.req.formData();
    const orderDataStr = formData.get("orderData") as string;
    if (!orderDataStr) {
      return c.json(
        { success: false, message: "受注データ(orderData)が送信されていません" },
        400,
      );
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(orderDataStr);
    } catch {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(SalesOrderPayloadSchema, jsonBody);
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
salesOrdersRouter.put(
  "/:id",
  describeApiRoute({
    summary: "受注修正",
    tags: ["sales-orders"],
    responses: {
      200: { description: "更新成功" },
      400: { description: "修正データ未送信、JSON不正、またはバリデーションエラー(SalesOrderPayloadSchema)" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const formData = await c.req.formData();
    const orderDataStr = formData.get("orderData") as string;
    if (!orderDataStr) {
      return c.json({ success: false, message: "修正データが見つかりません" }, 400);
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(orderDataStr);
    } catch {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(SalesOrderPayloadSchema, jsonBody);
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
salesOrdersRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "受注削除",
    tags: ["sales-orders"],
    responses: { 200: { description: "削除成功" } },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).deleteOrder(c, id);
    return c.json(result);
  },
);

// ==========================================
// 承認申請提出(DRAFT→PENDING_APPROVAL、承認機能OFF時は直接APPROVED。ON時は与信確認を実施)
// ==========================================
salesOrdersRouter.post(
  "/:id/submit-for-approval",
  describeApiRoute({
    summary: "受注の承認申請(与信確認込み)",
    tags: ["sales-orders"],
    responses: {
      200: { description: "申請成功(または承認機能OFF時は直接確定)" },
      400: { description: "下書き状態でない、与信限度額超過、または承認フロー未定義等" },
      404: { description: "対象の受注が見つからない" },
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
// Item7残課題2-5フォローアップ6: 承認済み受注への変更申請提出(申請時点で在庫を確保する)
// ==========================================
salesOrdersRouter.post(
  "/:id/submit-update",
  describeApiRoute({
    summary: "承認済み受注への変更申請(申請時点で在庫を確保する)",
    tags: ["sales-orders"],
    responses: {
      200: { description: "申請成功" },
      400: { description: "APPROVED状態でない、既に申請済みの申請がある、承認フロー未定義等" },
      404: { description: "対象の受注が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const result = await getService(c).submitUpdateForApproval(c, id, body);
    return c.json(result);
  },
);

// ==========================================
// Item7残課題6: 受注→出荷指示/出庫の消込連携(受注明細ごとの出荷済/残数量・倉庫別引当内訳)
// ==========================================
salesOrdersRouter.get(
  "/:id/shipment-progress",
  describeApiRoute({
    summary: "受注明細ごとの出荷済/残数量・倉庫別引当内訳を取得(出荷指示/出庫の作成導線用)",
    tags: ["sales-orders"],
    responses: {
      200: { description: "取得成功" },
      404: { description: "対象の受注が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).getShipmentProgress(c, id);
    return c.json(result);
  },
);

// ==========================================
// Item7残課題2-5(#2): 品目の倉庫別在庫参照(FIFO自動割当の提案・受注フォームでの参照表示)
// ==========================================
salesOrdersRouter.get(
  "/warehouse-stock/:itemId",
  describeApiRoute({
    summary: "品目の倉庫別の利用可能在庫数量を取得(在庫が多い順)",
    tags: ["sales-orders"],
    responses: {
      200: { description: "取得成功" },
    },
  }),
  async (c) => {
    const itemId = c.req.param("itemId");
    const result = await getService(c).getWarehouseStock(c, itemId);
    return c.json(result);
  },
);

// ==========================================
// Item7残課題2-5(#4): 品目の引当元受注一覧(在庫一覧画面のトレーサビリティ表示用)
// ==========================================
salesOrdersRouter.get(
  "/reservations/:itemId",
  describeApiRoute({
    summary: "品目を引き当てている受注の一覧を取得",
    tags: ["sales-orders"],
    responses: {
      200: { description: "取得成功" },
    },
  }),
  async (c) => {
    const itemId = c.req.param("itemId");
    const result = await getService(c).getOrderReservationsForItem(itemId);
    return c.json(result);
  },
);

// ==========================================
// Item7残課題2-5: バックオーダーの手動再引当
// ==========================================
salesOrdersRouter.post(
  "/:id/retry-backorder",
  describeApiRoute({
    summary: "受注のバックオーダー(引当不足分)の再引当を試みる",
    tags: ["sales-orders"],
    responses: {
      200: { description: "再引当処理を実行(全件解消/一部解消/変化なしのいずれも200)" },
      400: { description: "APPROVED状態でない等" },
      404: { description: "対象の受注が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).retryBackorder(c, id);
    return c.json(result);
  },
);

// ==========================================
// 削除申請(DRAFT・未申請は直接削除、APPROVEDは削除承認申請)
// ==========================================
salesOrdersRouter.post(
  "/:id/request-deletion",
  describeApiRoute({
    summary: "受注の削除申請(または未申請DRAFTの直接削除)",
    tags: ["sales-orders"],
    responses: {
      200: { description: "削除成功、または削除申請の申請成功" },
      400: { description: "承認処理中等、削除申請できない状態" },
      404: { description: "対象の受注が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).requestOrderDeletion(c, id);
    return c.json(result);
  },
);

// ==========================================
// PDF生成
// ==========================================
salesOrdersRouter.post(
  "/:id/generate-pdf",
  describeApiRoute({
    summary: "注文請書PDF生成",
    tags: ["sales-orders"],
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
salesOrdersRouter.get(
  "/download/:id/:attachmentId",
  describeApiRoute({
    summary: "受注添付ファイル配信・ダウンロード",
    tags: ["sales-orders"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "R2上に実体ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");

    const { attachment } = await getService(c).getDownloadStream(id, attachmentId);

    const fileObject = await getWithFallback({ primary: c.env.SALES_ORDERS_BUCKET, legacy: c.env.QUATES_BUCKET }, attachment.attachmentR2Path!);
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
// Item7: OTPダウンロード(外部公開エンドポイント。API_KEYチェック対象外、
// index.tsの許可リストに本ルートのパスパターンを明示的に追加している)
// ==========================================
salesOrdersRouter.post(
  "/download-request/:id/:attachmentId",
  describeApiRoute({
    summary: "注文請書ダウンロード用OTPの発行(外部公開)",
    tags: ["sales-orders"],
    json: RequestDownloadOtpSchema,
    responses: {
      200: { description: "OTP送信要求を受け付けた(登録済みメールの場合のみ実際に送信)" },
      400: { description: "バリデーションエラー" },
      404: { description: "対象の受注・添付ファイルが存在しない" },
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

salesOrdersRouter.post(
  "/download-verify/:id/:attachmentId",
  describeApiRoute({
    summary: "注文請書ダウンロード用OTPの検証・ファイル配信(外部公開)",
    tags: ["sales-orders"],
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

      const fileObject = await getWithFallback({ primary: c.env.SALES_ORDERS_BUCKET, legacy: c.env.QUATES_BUCKET }, attachment.attachmentR2Path!);
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
// 承認済注文請書の一括メール配信リレー
// ==========================================
salesOrdersRouter.post(
  "/bulk-send-email",
  describeApiRoute({
    summary: "承認済み注文請書の一括メール送信",
    tags: ["sales-orders"],
    json: BulkSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "バリデーションエラー" },
      404: { description: "承認済みかつ有効な受注データが見つからない" },
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
// 一括出荷指示/出庫作成: プレビュー計算(副作用なし)
// ==========================================
salesOrdersRouter.post(
  "/bulk-shipment-plan",
  describeApiRoute({
    summary: "選択受注から作成予定の出荷指示/出庫のプレビューを計算(DB書き込みなし)",
    tags: ["sales-orders"],
    json: BulkShipmentPlanSchema,
    responses: {
      200: { description: "計算成功" },
      400: { description: "バリデーションエラー" },
    },
  }),
  async (c) => {
    const body = await c.req.json();
    const parsed = v.safeParse(BulkShipmentPlanSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const results = await getService(c).computeBulkShipmentPlan(c, parsed.output.orderIds);
      return c.json({ success: true, results });
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// ==========================================
// 一括出荷指示/出庫作成: 確定実行
// ==========================================
salesOrdersRouter.post(
  "/bulk-shipment-execute",
  describeApiRoute({
    summary: "選択受注から出荷指示/出庫をまとめて作成する(1受注1ヘッダー、部分失敗は個別に記録)",
    tags: ["sales-orders"],
    json: BulkShipmentPlanSchema,
    responses: {
      200: { description: "実行完了(部分失敗を含む場合もresultsで返す)" },
      400: { description: "バリデーションエラー" },
    },
  }),
  async (c) => {
    const body = await c.req.json();
    const parsed = v.safeParse(BulkShipmentPlanSchema, body);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    try {
      const result = await getService(c).executeBulkShipmentPlan(c, parsed.output.orderIds);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// ==========================================
// 個別注文請書の単独メール配信
// ==========================================
salesOrdersRouter.post(
  "/:id/send-email",
  describeApiRoute({
    summary: "個別注文請書の個別メール送信",
    tags: ["sales-orders"],
    json: SingleSendEmailSchema,
    responses: {
      200: { description: "配信成功" },
      400: { description: "送信先メールアドレスの入力内容に不備" },
      404: { description: "承認済みかつ有効な受注データが見つからない" },
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

export { salesOrdersRouter };
