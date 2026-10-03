import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { ApprovalFlowsService } from "./approval-flows.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
  describeApiRoute,
} from "../../../platform/openapi/describe-route";
import {
  createApprovalFlowSchema,
  previewRouteQuerySchema,
} from "./approval-flows.schema";
import { todayJst } from "../../../platform/date/format-jst-date";

const approvalFlowsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new ApprovalFlowsService(c.env);
}

// 1. 全ての承認フローを一覧取得
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
approvalFlowsRouter.get(
  "/",
  describeListRoute({
    summary: "承認フロー一覧取得",
    tags: ["approval-flows"],
    itemDescription: "承認フロー(ステップ込み)",
  }),
  async (c) => {
  const service = getService(c);
  const query = c.req.query();
  const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
  if (query.page === undefined && query.limit === undefined) {
    const flows = await service.getAllFlowsWithSteps(sort);
    return c.json(flows);
  }
  const params = parsePaginationParams(query);
  const result = await service.getFlowsWithStepsPage(params, sort);
  return c.json(result);
});

// 2. 承認フロー ＆ ステップの新設 (POST)
approvalFlowsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "承認フロー新規登録",
    tags: ["approval-flows"],
    json: createApprovalFlowSchema,
    successDescription: "作成成功",
    errors: [{ status: 400, description: "入力パラメータが不正" }],
  }),
  vValidator("json", createApprovalFlowSchema, validationHook()),
  async (c) => {
    const body = c.req.valid("json");
    try {
      const service = getService(c);
      const result = await service.createFlow(c, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "データベースへの永続化に失敗しました");
    }
  },
);

// 3. 既存承認フローの変更・修正上書き (PUT)
approvalFlowsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "承認フロー更新",
    tags: ["approval-flows"],
    json: createApprovalFlowSchema,
    successDescription: "更新成功",
    errors: [{ status: 400, description: "入力パラメータが不正" }],
  }),
  vValidator("json", createApprovalFlowSchema, validationHook()),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");

    try {
      const service = getService(c);
      const result = await service.updateFlow(c, id, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "承認フローの更新に失敗しました");
    }
  },
);

// 4. 承認フローの無効化 (POST)
approvalFlowsRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "承認フロー無効化",
    tags: ["approval-flows"],
    successDescription: "無効化成功",
  }),
  async (c) => {
  const id = c.req.param("id");

  try {
    const service = getService(c);
    const result = await service.suspendFlow(c, id);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "承認フローの無効化に失敗しました");
  }
});

// 5. 承認フローの完全物理消去 (PURGE)
approvalFlowsRouter.delete(
  "/:id/purge",
  describeDeleteRoute({
    summary: "承認フロー完全物理削除",
    tags: ["approval-flows"],
    successDescription: "削除成功",
    errors: [{ status: 400, description: "有効なフローは削除不可(先に無効化が必要)" }],
  }),
  async (c) => {
  const id = c.req.param("id");

  try {
    const service = getService(c);
    const result = await service.purgeFlow(c, id);
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "承認フローの完全削除に失敗しました");
  }
});

// 6. CSV出力API
approvalFlowsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "承認フローCSVダウンロード", tags: ["approval-flows"] }),
  async (c) => {
  try {
    const service = getService(c);
    const responseBody = await service.generateCsv(c);

    return c.body(responseBody, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="approval_flows_export_${todayJst()}.csv"`,
    });
  } catch (err) {
    return respondError(c, err, "CSV作成処理中にエラーが発生しました");
  }
});

// 7. CSVインポートAPI
approvalFlowsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "承認フローCSVインポート",
    tags: ["approval-flows"],
    successDescription: "インポート成功",
    errors: [{ status: 400, description: "ファイル未添付などの入力エラー" }],
  }),
  async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json(
        { success: false, message: "CSVファイルが添付されていません" },
        400,
      );
    }

    const service = getService(c);
    const result = await service.bulkRegister(c, file);

    return c.json(result);
  } catch (err) {
    return respondError(c, err, "インポート処理中にサーバー内部エラーが発生しました");
  }
});

// 8. 新規要望: 承認フローの申請経路プレビュー(2026-09-22確定、read-only)
approvalFlowsRouter.get(
  "/preview-route",
  describeApiRoute({
    summary: "承認フローの申請経路プレビュー(ユーザー・書類種別・仮の金額から経路をシミュレーション)",
    tags: ["approval-flows"],
    query: previewRouteQuerySchema,
    responses: { 200: { description: "シミュレーション結果" } },
  }),
  vValidator("query", previewRouteQuerySchema, validationHook()),
  async (c) => {
    const { userId, targetType, amount } = c.req.valid("query");
    try {
      const service = getService(c);
      const result = await service.previewApprovalRoute({
        userId,
        targetType,
        amount,
      });
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "申請経路のプレビューに失敗しました");
    }
  },
);

export { approvalFlowsRouter };
