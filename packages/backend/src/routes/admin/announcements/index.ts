import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { AnnouncementsService } from "./announcements.service";
import { AnnouncementPayloadSchema, AnnouncementPreviewSchema } from "./announcements.schema";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { describeApiRoute } from "../../../platform/openapi/describe-route";

const announcementsRouter = new Hono<{ Bindings: Env }>();

announcementsRouter.onError((err, c) => respondError(c, err));

const service = new AnnouncementsService();

// ダッシュボード用(全ユーザーが参照する): 公開中・掲載期間内のお知らせ
announcementsRouter.get(
  "/active",
  describeApiRoute({
    summary: "システムからのお知らせ(公開中・掲載期間内)",
    tags: ["announcements"],
    responses: { 200: { description: "重要なものを先頭に、掲載日の新しい順" } },
  }),
  async (c) => c.json(await service.listActive(c.env)),
);

// 管理画面用: 下書き・期限切れを含む全件
announcementsRouter.get(
  "/",
  describeApiRoute({
    summary: "システムからのお知らせ一覧(管理画面用、全件)",
    tags: ["announcements"],
    responses: { 200: { description: "掲載日の新しい順" } },
  }),
  async (c) => c.json(await service.listAll(c.env)),
);

// 入力中のHTMLが、実際にどう表示されるか(無害化後)を返す。編集画面のプレビュー用でDBには保存しない
announcementsRouter.post(
  "/preview",
  describeApiRoute({
    summary: "お知らせ本文(HTML)のプレビュー(無害化後のHTMLを返す)",
    tags: ["announcements"],
    json: AnnouncementPreviewSchema,
    responses: { 200: { description: "{html}: 実際に表示されるHTML" }, 400: { description: "入力不正" } },
  }),
  async (c) => {
    const parsed = v.safeParse(AnnouncementPreviewSchema, await c.req.json());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(service.preview(parsed.output.body));
  },
);

announcementsRouter.post(
  "/register",
  describeApiRoute({
    summary: "システムからのお知らせの登録",
    tags: ["announcements"],
    json: AnnouncementPayloadSchema,
    responses: { 200: { description: "登録したお知らせ" }, 400: { description: "入力不正" } },
  }),
  async (c) => {
    const parsed = v.safeParse(AnnouncementPayloadSchema, await c.req.json());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.create(c, parsed.output));
  },
);

announcementsRouter.put(
  "/:id",
  describeApiRoute({
    summary: "システムからのお知らせの更新",
    tags: ["announcements"],
    json: AnnouncementPayloadSchema,
    responses: { 200: { description: "更新後のお知らせ" }, 404: { description: "存在しない" } },
  }),
  async (c) => {
    const parsed = v.safeParse(AnnouncementPayloadSchema, await c.req.json());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.update(c, c.req.param("id"), parsed.output));
  },
);

announcementsRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "システムからのお知らせの削除",
    tags: ["announcements"],
    responses: { 200: { description: "削除成功" }, 404: { description: "存在しない" } },
  }),
  async (c) => c.json(await service.remove(c, c.req.param("id"))),
);

export { announcementsRouter };
