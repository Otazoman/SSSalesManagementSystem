import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { ScreenDescriptionsService } from "./screen-descriptions.service";
import {
  ScreenDescriptionPayloadSchema,
  ScreenDescriptionPreviewSchema,
  ScreenPathSchema,
} from "./screen-descriptions.schema";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { describeApiRoute } from "../../../platform/openapi/describe-route";

const screenDescriptionsRouter = new Hono<{ Bindings: Env }>();

screenDescriptionsRouter.onError((err, c) => respondError(c, err));

const service = new ScreenDescriptionsService();

screenDescriptionsRouter.get(
  "/",
  describeApiRoute({
    summary: "各画面の説明(全件)。各画面の見出しが読み込む",
    tags: ["screen-descriptions"],
    responses: { 200: { description: "[{path, descriptionHtml(無害化済み), updatedBy, updatedAt}]" } },
  }),
  async (c) => c.json(await service.listAll(c.env)),
);

screenDescriptionsRouter.post(
  "/preview",
  describeApiRoute({
    summary: "画面の説明(HTML)のプレビュー(無害化後のHTMLを返す。保存しない)",
    tags: ["screen-descriptions"],
    json: ScreenDescriptionPreviewSchema,
    responses: { 200: { description: "{html}" }, 400: { description: "入力不正" } },
  }),
  async (c) => {
    const parsed = v.safeParse(ScreenDescriptionPreviewSchema, await c.req.json());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(service.preview(parsed.output.body));
  },
);

screenDescriptionsRouter.put(
  "/",
  describeApiRoute({
    summary: "画面の説明の登録・更新(パス指定。保存時にHTMLを無害化する)",
    tags: ["screen-descriptions"],
    json: ScreenDescriptionPayloadSchema,
    responses: { 200: { description: "保存した説明" }, 400: { description: "入力不正" } },
  }),
  async (c) => {
    const parsed = v.safeParse(ScreenDescriptionPayloadSchema, await c.req.json());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.upsert(c, parsed.output));
  },
);

screenDescriptionsRouter.delete(
  "/",
  describeApiRoute({
    summary: "画面の説明を削除(既定の説明に戻す)",
    tags: ["screen-descriptions"],
    responses: { 200: { description: "削除成功" }, 404: { description: "未設定" } },
  }),
  async (c) => {
    const parsed = v.safeParse(ScreenPathSchema, c.req.query("path") ?? "");
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.remove(c, parsed.output));
  },
);

export { screenDescriptionsRouter };
