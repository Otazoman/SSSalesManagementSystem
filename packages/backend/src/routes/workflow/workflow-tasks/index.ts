import { Hono, type Context } from "hono";
import * as v from "valibot";
import type { Env } from "../../../types/env";
import {
  MyPendingQuerySchema,
  ApproveRequestSchema,
  RemandRequestSchema,
  HistoryQuerySchema,
  BulkApproveRequestSchema,
  BulkRemandRequestSchema,
  CancelRequestSchema,
} from "./workflow-tasks.schema";
import { WorkflowTasksService } from "./workflow-tasks.service";
import { WorkflowTasksRepository, createWorkflowTasksDb } from "./workflow-tasks.repository";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { getSession } from "../../../platform/auth/get-session";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeListRoute,
  describeMutationRoute,
} from "../../../platform/openapi/describe-route";

const workflowTasksRouter = new Hono<{ Bindings: Env }>();

// BUG-013: 操作する人(承認者・申請者)は、ブラウザから送られた userId ではなく、ログイン情報
// (署名付きのセッション cookie)から決める。送られた userId は、API の形を変えないため受け取るが使わない。
async function getSessionUserId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const session = await getSession(c);
  return session?.userId ?? null;
}

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json({ success: false, message: "ログイン情報が確認できません。再度ログインしてください" }, 401);
}

/** 自分が承認すべきタスク一覧の取得 */
workflowTasksRouter.get(
  "/my-pending",
  describeListRoute({
    summary: "自分が承認すべきタスク一覧取得",
    tags: ["workflow-tasks"],
    query: MyPendingQuerySchema,
    itemDescription: "承認待ちタスク",
  }),
  async (c) => {
  try {
    const parseResult = v.safeParse(MyPendingQuerySchema, {
      userId: c.req.query("userId") || "",
    });

    if (!parseResult.success) {
      return respondValidationError(c, parseResult.issues);
    }

    const userId = await getSessionUserId(c);
    if (!userId) return unauthorized(c);

    const db = createWorkflowTasksDb(c.env.DB);
    const rawQuery = c.req.query();
    if (rawQuery.page === undefined && rawQuery.limit === undefined) {
      const tasks = await WorkflowTasksService.getMyPendingTasks(db, userId);
      return c.json(tasks);
    }
    const paginationParams = parsePaginationParams(rawQuery);
    const result = await WorkflowTasksService.getMyPendingTasksPage(
      db,
      userId,
      paginationParams,
    );
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "タスク一覧の取得に失敗しました");
  }
});

/** 承認処理 */
workflowTasksRouter.post(
  "/approve",
  describeMutationRoute({
    summary: "ワークフロータスク承認処理",
    tags: ["workflow-tasks"],
    json: ApproveRequestSchema,
    successDescription: "承認成功",
  }),
  async (c) => {
  try {
    const rawBody = await c.req.json();
    const parseResult = v.safeParse(ApproveRequestSchema, rawBody);

    if (!parseResult.success) {
      return respondValidationError(c, parseResult.issues);
    }

    const userId = await getSessionUserId(c);
    if (!userId) return unauthorized(c);

    const db = createWorkflowTasksDb(c.env.DB);
    const result = await WorkflowTasksService.approveTask(c, db, {
      ...parseResult.output,
      userId,
    });
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "承認処理に失敗しました");
  }
});

/** 差戻し処理 */
workflowTasksRouter.post(
  "/remand",
  describeMutationRoute({
    summary: "ワークフロータスク差戻し処理",
    tags: ["workflow-tasks"],
    json: RemandRequestSchema,
    successDescription: "差戻し成功",
  }),
  async (c) => {
  try {
    const rawBody = await c.req.json();
    const parseResult = v.safeParse(RemandRequestSchema, rawBody);

    if (!parseResult.success) {
      return respondValidationError(c, parseResult.issues);
    }

    const userId = await getSessionUserId(c);
    if (!userId) return unauthorized(c);

    const db = createWorkflowTasksDb(c.env.DB);
    const result = await WorkflowTasksService.remandTask(c, db, {
      ...parseResult.output,
      userId,
    });
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "差戻し処理に失敗しました");
  }
});

/** 過去の承認・差戻し履歴一覧を取得 */
workflowTasksRouter.get(
  "/history",
  describeListRoute({
    summary: "承認・差戻し履歴一覧取得",
    tags: ["workflow-tasks"],
    query: HistoryQuerySchema,
    itemDescription: "承認・差戻し履歴(進捗ステップ込み)",
  }),
  async (c) => {
  try {
    const parseResult = v.safeParse(HistoryQuerySchema, {
      userId: c.req.query("userId") || "",
      status: c.req.query("status") || "",
      applicantId: c.req.query("applicantId") || "",
      startDate: c.req.query("startDate") || "",
      endDate: c.req.query("endDate") || "",
    });

    if (!parseResult.success) {
      return respondValidationError(c, parseResult.issues);
    }

    const userId = await getSessionUserId(c);
    if (!userId) return unauthorized(c);
    const query = { ...parseResult.output, userId };

    const db = createWorkflowTasksDb(c.env.DB);
    const rawQuery = c.req.query();
    if (rawQuery.page === undefined && rawQuery.limit === undefined) {
      const result = await WorkflowTasksService.getHistory(db, query);
      return c.json(result);
    }
    const paginationParams = parsePaginationParams(rawQuery);
    const result = await WorkflowTasksService.getHistoryPage(
      db,
      query,
      paginationParams,
    );
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "履歴情報の取得に失敗しました");
  }
});

/** 一括承認処理 */
workflowTasksRouter.post(
  "/bulk-approve",
  describeMutationRoute({
    summary: "ワークフロータスク一括承認処理",
    tags: ["workflow-tasks"],
    json: BulkApproveRequestSchema,
    successDescription: "一括承認成功",
    errors: [{ status: 400, description: "処理対象が選択されていない" }],
  }),
  async (c) => {
  try {
    const rawBody = await c.req.json();
    const parseResult = v.safeParse(BulkApproveRequestSchema, rawBody);

    if (!parseResult.success) {
      return respondValidationError(c, parseResult.issues);
    }

    const userId = await getSessionUserId(c);
    if (!userId) return unauthorized(c);

    const db = createWorkflowTasksDb(c.env.DB);
    // ⭕ 第1引数に c を渡すように修正
    const result = await WorkflowTasksService.bulkApprove(c, db, {
      ...parseResult.output,
      userId,
    });
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "一括承認処理に失敗しました");
  }
});

/** 一括差戻し処理 */
workflowTasksRouter.post(
  "/bulk-remand",
  describeMutationRoute({
    summary: "ワークフロータスク一括差戻し処理",
    tags: ["workflow-tasks"],
    json: BulkRemandRequestSchema,
    successDescription: "一括差戻し成功",
    errors: [{ status: 400, description: "処理対象が選択されていない" }],
  }),
  async (c) => {
  try {
    const rawBody = await c.req.json();
    const parseResult = v.safeParse(BulkRemandRequestSchema, rawBody);

    if (!parseResult.success) {
      return respondValidationError(c, parseResult.issues);
    }

    const userId = await getSessionUserId(c);
    if (!userId) return unauthorized(c);

    const db = createWorkflowTasksDb(c.env.DB);
    const result = await WorkflowTasksService.bulkRemand(c, db, {
      ...parseResult.output,
      userId,
    });
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "一括差戻し処理に失敗しました");
  }
});

/** 最新申請ステータスの確認 */
workflowTasksRouter.get(
  "/request-status/:targetId",
  describeApiRoute({
    summary: "最新申請ステータス確認",
    tags: ["workflow-tasks"],
    responses: { 200: { description: "申請有無・ステータス・種別・申請者ID" } },
  }),
  async (c) => {
  try {
    const targetId = c.req.param("targetId");
    // Item5: partners以外のtargetType(units/locations/partner-contacts等)にも対応するため、
    // クエリパラメータでtargetTypeを受け取れるようにする(既存呼び出し元は未指定のままなら
    // 従来通りmaster_partners扱いを維持、後方互換)
    const targetType = c.req.query("targetType") || "master_partners";
    const db = createWorkflowTasksDb(c.env.DB);

    const latestRequest =
      await WorkflowTasksRepository.getLatestMasterApprovalRequest(
        db,
        targetId,
        targetType,
      );

    if (!latestRequest) {
      return c.json({ hasRequest: false, status: null });
    }

    return c.json({
      hasRequest: true,
      requestId: latestRequest.id,
      status: latestRequest.status,
      requestType: latestRequest.requestType,
      applicantId: latestRequest.applicantId,
    });
  } catch (err) {
    return respondError(c, err, "ステータス取得に失敗しました");
  }
});

/** 「修正して再提出」ボタンの遷移先パス解決(画面構成再編フェーズ5) */
workflowTasksRouter.get(
  "/edit-path/:targetId",
  describeApiRoute({
    summary: "「修正して再申請」の遷移先パス解決",
    tags: ["workflow-tasks"],
    responses: { 200: { description: "解決された編集画面パス(見つからない場合はnull)" } },
  }),
  async (c) => {
  try {
    const targetId = c.req.param("targetId");
    const targetType = c.req.query("targetType") || "";
    if (!targetType) {
      return c.json({ path: null });
    }
    const db = createWorkflowTasksDb(c.env.DB);
    const path = await WorkflowTasksService.resolveEditPath(db, targetType, targetId);
    return c.json({ path });
  } catch (err) {
    return respondError(c, err, "編集画面パスの解決に失敗しました");
  }
});

/** 申請の取下げ（クローズ）処理 */
workflowTasksRouter.post(
  "/cancel",
  describeMutationRoute({
    summary: "申請の取下げ(クローズ)処理",
    tags: ["workflow-tasks"],
    json: CancelRequestSchema,
    successDescription: "取下げ成功",
  }),
  async (c) => {
  try {
    const rawBody = await c.req.json();
    const parseResult = v.safeParse(CancelRequestSchema, rawBody);

    if (!parseResult.success) {
      return respondValidationError(c, parseResult.issues);
    }

    const userId = await getSessionUserId(c);
    if (!userId) return unauthorized(c);

    const db = createWorkflowTasksDb(c.env.DB);
    const result = await WorkflowTasksService.cancelTask(c, db, {
      ...parseResult.output,
      userId,
    });
    return c.json(result);
  } catch (err) {
    return respondError(c, err, "取下げに失敗しました");
  }
});

export { workflowTasksRouter };
