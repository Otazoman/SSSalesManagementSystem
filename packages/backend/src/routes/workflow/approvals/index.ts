import { Hono } from "hono";
import * as v from "valibot";
import type { Env } from "../../../types/env";
import { ApprovalRequestSchema } from "./approvals.schema";
import { ApprovalService } from "./approvals.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { createDb } from "../../../platform/db/create-db";
import { describeApiRoute } from "../../../platform/openapi/describe-route";

const approvalsRouter = new Hono<{ Bindings: Env }>();

/**
 * マスタ・伝票共通：既存データの変更(UPDATE)・削除(DELETE)等の申請を一括で受け付けるエンドポイント
 */
approvalsRouter.post(
  "/request-update",
  describeApiRoute({
    summary: "承認申請(UPDATE/DELETE等)の一括受付",
    tags: ["approvals"],
    json: ApprovalRequestSchema,
    responses: {
      200: { description: "申請受付成功" },
      400: { description: "必須パラメータ不足" },
    },
  }),
  async (c) => {
  try {
    const rawBody = await c.req.json();

    // Valibot による入力バリデーション
    const parseResult = v.safeParse(ApprovalRequestSchema, rawBody);
    if (!parseResult.success) {
      return respondValidationError(c, parseResult.issues);
    }

    const db = createDb(c.env.DB);
    const result = await ApprovalService.handleRequestUpdate(
      c,
      db,
      parseResult.output,
    );

    return c.json(result.data, result.status);
  } catch (err) {
    return respondError(c, err, "承認申請の処理に失敗しました");
  }
});

export { approvalsRouter };
