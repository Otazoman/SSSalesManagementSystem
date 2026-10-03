import { Hono } from "hono";
import { Env } from "../../../types/env";
import { JournalPostingEventsService } from "./journal-posting-events.service";
import { respondError } from "../../../platform/http/error-handler";
import { describeListRoute, describeApiRoute } from "../../../platform/openapi/describe-route";

const journalPostingEventsRouter = new Hono<{ Bindings: Env }>();

journalPostingEventsRouter.onError((err, c) => respondError(c, err));

function getService(c: any): JournalPostingEventsService {
  return new JournalPostingEventsService(c.env.DB);
}

// ==========================================
// 一覧取得: 直近200件(仕訳データ出力画面の「未転記/転記済み一覧」)
// ==========================================
journalPostingEventsRouter.get(
  "/",
  describeListRoute({
    summary: "仕訳起票イベント一覧取得(直近200件)",
    tags: ["journal-posting-events"],
    itemDescription: "仕訳起票イベント(outbox)",
  }),
  async (c) => {
    const query = c.req.query();
    const result = await getService(c).list({ sortBy: query.sortBy, sortOrder: query.sortOrder });
    return c.json(result);
  },
);

// ==========================================
// 再転記: 失敗(FAILED)した起票イベントを、人が明示的に再試行する唯一の経路
// (ユーザー確認済み: 自動再試行のバッチ処理は行わない)
// ==========================================
journalPostingEventsRouter.post(
  "/:id/retry",
  describeApiRoute({
    summary: "仕訳の再転記(人による明示的な再試行)",
    tags: ["journal-posting-events"],
    responses: {
      200: { description: "再転記の結果(成功/失敗いずれもレスポンス自体は200)" },
      400: { description: "既に転記済み" },
      404: { description: "対象の起票イベントが見つからない" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const result = await getService(c).retry(c, id);
    return c.json(result);
  },
);

export { journalPostingEventsRouter };
