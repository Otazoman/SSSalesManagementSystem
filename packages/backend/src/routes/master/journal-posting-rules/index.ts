import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { JournalPostingRulesService } from "./journal-posting-rules.service";
import {
  JournalEventTypeSchema,
  UpdateJournalPostingRuleSchema,
} from "./journal-posting-rules.schema";
import { validationHook, respondError } from "../../../platform/http/error-handler";
import * as v from "valibot";
import {
  describeListRoute,
  describeMutationRoute,
} from "../../../platform/openapi/describe-route";

const journalPostingRulesRouter = new Hono<{ Bindings: Env }>();

journalPostingRulesRouter.onError((err, c) => respondError(c, err));

function getService(c: any): JournalPostingRulesService {
  return new JournalPostingRulesService(c.env.DB);
}

// ==========================================
// 一覧取得: 固定4イベント種別(PREPAYMENT/PURCHASE/ADVANCE_RECEIPT/SALES)を必ず4件返す
// ==========================================
journalPostingRulesRouter.get(
  "/",
  describeListRoute({
    summary: "仕訳ルールマスタ一覧取得(固定4件)",
    tags: ["journal-posting-rules"],
    itemDescription: "仕訳ルール(会計事象ごとの勘定科目設定)",
  }),
  async (c) => {
    const result = await getService(c).getAll();
    return c.json(result);
  },
);

// ==========================================
// 更新: eventTypeが固定PKのため新規作成・削除は提供しない(常にこの4行のみ)
// ==========================================
journalPostingRulesRouter.put(
  "/:eventType",
  describeMutationRoute({
    summary: "仕訳ルールマスタ更新",
    tags: ["journal-posting-rules"],
    json: UpdateJournalPostingRuleSchema,
    successDescription: "更新成功",
  }),
  vValidator("json", UpdateJournalPostingRuleSchema, validationHook()),
  async (c) => {
    const parsedEventType = v.safeParse(JournalEventTypeSchema, c.req.param("eventType"));
    if (!parsedEventType.success) {
      return c.json(
        { success: false, message: "eventTypeはPREPAYMENT/PURCHASE/ADVANCE_RECEIPT/SALESのいずれかです" },
        400,
      );
    }
    const input = c.req.valid("json");
    const result = await getService(c).update(c, parsedEventType.output, input);
    return c.json(result);
  },
);

export { journalPostingRulesRouter };
