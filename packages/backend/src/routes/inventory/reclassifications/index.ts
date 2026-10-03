import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { ReclassificationsRepository } from "./reclassifications.repository";
import { ReclassificationsService } from "./reclassifications.service";
import { respondError } from "../../../platform/http/error-handler";
import {
  describeMutationRoute,
  describeApiRoute,
} from "../../../platform/openapi/describe-route";
import { createReclassificationSchema } from "./reclassifications.schema";

const stockReclassificationsRouter = new Hono<{ Bindings: Env }>();

const getService = (c: any) =>
  new ReclassificationsService(new ReclassificationsRepository(c.env.DB));

// 品質区分変更詳細 (GET /:id)
stockReclassificationsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "品質区分変更詳細取得",
    tags: ["stock-reclassifications"],
    responses: {
      200: { description: "品質区分変更レコード" },
      404: { description: "対象の品質区分変更が見つからない" },
    },
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const service = getService(c);
      const result = await service.getDetail(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "品質区分変更詳細取得に失敗しました");
    }
  },
);

// 品質区分変更確定 (POST /) : 良品⇔破損品/検品待ちの間で在庫を付け替える。
// 承認機能ON(is_damage_approval_enabled)なら承認申請、OFFなら即座に在庫反映する
stockReclassificationsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "在庫の品質区分変更(破損・不良品登録を含む)",
    tags: ["stock-reclassifications"],
    json: createReclassificationSchema,
    successDescription: "品質区分変更成功(承認機能ONの場合は承認を申請)",
    errors: [{ status: 400, description: "入力データ検証エラー" }],
  }),
  async (c) => {
    try {
      const rawBody = await c.req.json();
      const parsed = v.parse(createReclassificationSchema, rawBody);

      const service = getService(c);
      const result = await service.createReclassification(c, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "品質区分変更に失敗しました");
    }
  },
);

// 修正して再提出 (PUT /:id) : 差戻し済みの品質区分変更を同じidのまま書き換えて再申請する
stockReclassificationsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "品質区分変更の修正・再申請",
    tags: ["stock-reclassifications"],
    json: createReclassificationSchema,
    successDescription: "再申請成功(承認機能ONの場合は承認を申請)",
    errors: [
      { status: 400, description: "入力データ検証エラー、または差戻し状態以外の対象" },
      { status: 404, description: "対象の品質区分変更が見つからない" },
    ],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const rawBody = await c.req.json();
      const parsed = v.parse(createReclassificationSchema, rawBody);

      const service = getService(c);
      const result = await service.resubmitReclassification(c, id, parsed);

      return c.json(result);
    } catch (err) {
      return respondError(c, err, "品質区分変更の修正・再申請に失敗しました");
    }
  },
);

export { stockReclassificationsRouter };
