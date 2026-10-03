import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { PurchaseRequisitionRepository } from "./purchase-requisition.repository";
import { PurchaseRequisitionService } from "./purchase-requisition.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeListRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";
import {
  SearchPurchaseRequisitionsQuerySchema,
  PurchaseRequisitionPayloadSchema,
} from "./purchase-requisition.schema";
import { todayJst } from "../../../platform/date/format-jst-date";

type Variables = {
  purchaseRequisitionService: PurchaseRequisitionService;
};

const purchaseRequisitionsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

purchaseRequisitionsRouter.use("*", async (c, next) => {
  const repo = new PurchaseRequisitionRepository(c.env.DB);
  c.set("purchaseRequisitionService", new PurchaseRequisitionService(repo));
  await next();
});

purchaseRequisitionsRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): PurchaseRequisitionService =>
  c.get("purchaseRequisitionService");

// ==========================================
// 一覧検索
// ==========================================
purchaseRequisitionsRouter.get(
  "/",
  describeListRoute({
    summary: "購買申請一覧検索",
    tags: ["purchase-requisitions"],
    query: SearchPurchaseRequisitionsQuerySchema,
    itemDescription: "購買申請(添付ファイル込み)",
  }),
  async (c) => {
    const queryParams = c.req.query();
    const parsed = v.safeParse(SearchPurchaseRequisitionsQuerySchema, queryParams);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const rawQuery = c.req.query();
    const sort = { sortBy: parsed.output.sortBy, sortOrder: parsed.output.sortOrder };
    if (rawQuery.page === undefined && rawQuery.limit === undefined) {
      const result = await getService(c).searchRequisitions(c, parsed.output, sort);
      return c.json(result);
    }
    const paginationParams = parsePaginationParams(rawQuery);
    const result = await getService(c).searchRequisitionsPage(
      c,
      parsed.output,
      paginationParams,
      sort,
    );
    return c.json(result);
  },
);

// ==========================================
// CSVエクスポート
// ==========================================
purchaseRequisitionsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "購買申請CSVダウンロード", tags: ["purchase-requisitions"] }),
  async (c) => {
    const csvContent = await getService(c).exportCsv(c);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="purchase_requisitions_export_${todayJst()}.csv"`,
    });
  },
);

// ==========================================
// CSVインポート
// ==========================================
purchaseRequisitionsRouter.post(
  "/bulk-register",
  describeApiRoute({
    summary: "購買申請CSVインポート",
    tags: ["purchase-requisitions"],
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
  },
);

// ==========================================
// 個別詳細取得
// ==========================================
purchaseRequisitionsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "購買申請個別詳細取得",
    tags: ["purchase-requisitions"],
    responses: {
      200: { description: "購買申請詳細" },
      404: { description: "対象の購買申請が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const detail = await getService(c).getRequisitionDetail(c, id);
    if (!detail) {
      return c.json(
        { success: false, message: "対象の購買申請が見つかりません" },
        404,
      );
    }
    return c.json(detail);
  },
);

// ==========================================
// 新規登録
// ==========================================
purchaseRequisitionsRouter.post(
  "/register",
  describeApiRoute({
    summary: "購買申請新規登録",
    tags: ["purchase-requisitions"],
    responses: {
      200: { description: "登録成功" },
      400: { description: "requisitionData未送信、JSON不正、またはバリデーションエラー" },
    },
  }),
  async (c) => {
    const formData = await c.req.formData();
    const dataStr = formData.get("requisitionData") as string;
    if (!dataStr) {
      return c.json(
        { success: false, message: "購買申請データ(requisitionData)が送信されていません" },
        400,
      );
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(dataStr);
    } catch (e) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(PurchaseRequisitionPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).createRequisition(c, formData, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 修正
// ==========================================
purchaseRequisitionsRouter.put(
  "/:id",
  describeApiRoute({
    summary: "購買申請修正",
    tags: ["purchase-requisitions"],
    responses: {
      200: { description: "更新成功" },
      400: { description: "修正データ未送信、JSON不正、またはバリデーションエラー" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const formData = await c.req.formData();
    const dataStr = formData.get("requisitionData") as string;
    if (!dataStr) {
      return c.json({ success: false, message: "修正データが見つかりません" }, 400);
    }

    let jsonBody: any;
    try {
      jsonBody = JSON.parse(dataStr);
    } catch {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }

    const parsed = v.safeParse(PurchaseRequisitionPayloadSchema, jsonBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }

    const result = await getService(c).updateRequisition(c, id, formData, parsed.output);
    return c.json(result);
  },
);

// ==========================================
// 削除
// ==========================================
purchaseRequisitionsRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "購買申請削除",
    tags: ["purchase-requisitions"],
    responses: { 200: { description: "削除成功" } },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).deleteRequisition(c, id);
    return c.json(result);
  },
);

// ==========================================
// 承認申請提出
// ==========================================
purchaseRequisitionsRouter.post(
  "/:id/submit-for-approval",
  describeApiRoute({
    summary: "購買申請の承認申請",
    tags: ["purchase-requisitions"],
    responses: {
      200: { description: "申請成功(または承認機能OFF時は直接確定)" },
      400: { description: "下書き状態でない、または承認フロー未定義等" },
      404: { description: "対象の購買申請が見つからない" },
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
purchaseRequisitionsRouter.post(
  "/:id/request-deletion",
  describeApiRoute({
    summary: "購買申請の削除申請(または未申請DRAFTの直接削除)",
    tags: ["purchase-requisitions"],
    responses: {
      200: { description: "削除成功、または削除申請の申請成功" },
      400: { description: "承認処理中等、削除申請できない状態" },
      404: { description: "対象の購買申請が見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).requestRequisitionDeletion(c, id);
    return c.json(result);
  },
);

// ==========================================
// 添付ファイルのストリーミング配信・ダウンロード(社内向け、OTP認証なし)
// ==========================================
purchaseRequisitionsRouter.get(
  "/download/:id/:attachmentId",
  describeApiRoute({
    summary: "購買申請添付ファイル配信・ダウンロード",
    tags: ["purchase-requisitions"],
    responses: {
      200: { description: "ファイル本体" },
      404: { description: "R2上に実体ファイルが存在しない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const attachmentId = c.req.param("attachmentId");

    const { attachment } = await getService(c).getDownloadStream(id, attachmentId);

    const fileObject = await c.env.PURCHASE_REQUISITIONS_BUCKET.get(
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
      "Content-Type": fileObject.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodedFileName}`,
    };

    return c.body(fileObject.body, 200, headers);
  },
);

export { purchaseRequisitionsRouter };
