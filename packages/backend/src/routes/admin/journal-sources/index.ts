import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { JournalSourcesService } from "./journal-sources.service";
import {
  listAdvanceCandidatesQuerySchema,
  listJournalSourcesQuerySchema,
  postJournalSourceSchema,
} from "./journal-sources.schema";
import { respondError } from "../../../platform/http/error-handler";
import { describeApiRoute } from "../../../platform/openapi/describe-route";

const journalSourcesRouter = new Hono<{ Bindings: Env }>();

journalSourcesRouter.onError((err, c) => respondError(c, err));

// 未転記の伝票の一覧(種別ごと。日付・取引先で絞り込み)
journalSourcesRouter.get(
  "/",
  describeApiRoute({
    summary: "仕訳にしていない伝票の一覧(前払・前受・売上・仕入・入金・支払)",
    tags: ["journal-sources"],
    query: listJournalSourcesQuerySchema,
    responses: { 200: { description: "未転記の伝票の配列" }, 400: { description: "入力不備" } },
  }),
  async (c) => {
    const query = v.parse(listJournalSourcesQuerySchema, c.req.query());
    return c.json(await new JournalSourcesService(c).listUnposted(query));
  },
);

// 売上の前受金として充当できる単体入金の一覧(前受金として仕訳済みで、未充当残がある入金)
journalSourcesRouter.get(
  "/advance-candidates",
  describeApiRoute({
    summary: "前受金として充当できる単体入金の一覧",
    tags: ["journal-sources"],
    query: listAdvanceCandidatesQuerySchema,
    responses: { 200: { description: "単体入金と未充当残の配列" }, 400: { description: "入力不備" } },
  }),
  async (c) => {
    const query = v.parse(listAdvanceCandidatesQuerySchema, c.req.query());
    return c.json(await new JournalSourcesService(c).listAdvanceCandidates(query.partnerId));
  },
);

// 選んだ1件の伝票の仕訳の内容(借方・貸方の組)を確認する。保存はしない
journalSourcesRouter.post(
  "/preview",
  describeApiRoute({
    summary: "選んだ伝票の仕訳の内容を確認する(保存しない)",
    tags: ["journal-sources"],
    json: postJournalSourceSchema,
    responses: {
      200: { description: "摘要・計上日と、借方・貸方の組の配列" },
      400: { description: "入力不備・仕訳にできない伝票・仕訳ルールが無効" },
      404: { description: "対象の伝票が見つからない" },
    },
  }),
  async (c) => {
    const body = v.parse(postJournalSourceSchema, await c.req.json());
    return c.json(await new JournalSourcesService(c).preview(body));
  },
);

// 選んだ1件の伝票を仕訳にする(複数選択はフロントが1件ずつ呼ぶ)
journalSourcesRouter.post(
  "/post",
  describeApiRoute({
    summary: "選んだ伝票を仕訳にする(1件)",
    tags: ["journal-sources"],
    json: postJournalSourceSchema,
    responses: {
      200: { description: "転記の結果(成功/失敗いずれもレスポンス自体は200)" },
      400: { description: "入力不備・仕訳にできない伝票・仕訳ルールが無効" },
      404: { description: "対象の伝票が見つからない" },
    },
  }),
  async (c) => {
    const body = v.parse(postJournalSourceSchema, await c.req.json());
    return c.json(await new JournalSourcesService(c).post(body));
  },
);

export { journalSourcesRouter };
