import { Hono } from "hono";
import * as v from "valibot";
import type { Env } from "../../types/env";
import { DocumentCompletionRepository } from "./document-completion.repository";
import { DocumentCompletionService } from "./document-completion.service";
import { PROGRESS_STAGE_KEYS } from "../progress/progress.schema";
import { respondError } from "../../platform/http/error-handler";
import { describeApiRoute } from "../../platform/openapi/describe-route";

const documentCompletionRouter = new Hono<{ Bindings: Env }>();

documentCompletionRouter.onError((err, c) => respondError(c, err));

const TAGS = ["document-completion"];
const StageSchema = v.picklist(PROGRESS_STAGE_KEYS);
const SetPayloadSchema = v.object({ forcedState: v.nullable(v.picklist(["COMPLETED", "IN_PROGRESS"])) });
const getService = (c: any) => new DocumentCompletionService(new DocumentCompletionRepository(c.env.DB));

// 追加要望(2026-09-21): 進捗確認は閲覧専用にし、伝票の「完了/進行中」の手動設定は各伝票の画面から行う
documentCompletionRouter.get(
  "/:stage/:id",
  describeApiRoute({
    summary: "伝票の「完了/進行中」の手動設定を取得(forcedState=nullは自動判定)",
    tags: TAGS,
    responses: { 200: { description: "{stageKey, documentId, forcedState}" }, 400: { description: "工程キー不正" } },
  }),
  async (c) => {
    const stage = v.safeParse(StageSchema, c.req.param("stage"));
    if (!stage.success) return c.json({ success: false, message: "工程キーが不正です" }, 400);
    return c.json(await getService(c).get(stage.output, c.req.param("id")));
  },
);

documentCompletionRouter.put(
  "/:stage/:id",
  describeApiRoute({
    summary: "伝票の「完了/進行中」を手動設定(forcedState=nullで解除して自動判定に戻す)",
    tags: TAGS,
    json: SetPayloadSchema,
    responses: {
      200: { description: "保存成功" },
      400: { description: "入力不正" },
      404: { description: "伝票が存在しない" },
    },
  }),
  async (c) => {
    const stage = v.safeParse(StageSchema, c.req.param("stage"));
    if (!stage.success) return c.json({ success: false, message: "工程キーが不正です" }, 400);
    const body = v.safeParse(SetPayloadSchema, await c.req.json().catch(() => null));
    if (!body.success) return c.json({ success: false, message: "forcedStateはCOMPLETED / IN_PROGRESS / null のいずれかを指定してください" }, 400);
    return c.json(await getService(c).set(c, stage.output, c.req.param("id"), body.output.forcedState));
  },
);

export { documentCompletionRouter };
