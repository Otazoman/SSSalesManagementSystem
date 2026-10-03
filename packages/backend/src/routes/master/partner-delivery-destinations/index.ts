import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { PartnerDeliveryDestinationsService } from "./partner-delivery-destinations.service";
import { respondError } from "../../../platform/http/error-handler";
import { isForeignKeyConstraintError } from "../../../platform/http/http-error";
import {
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
} from "../../../platform/openapi/describe-route";
import {
  querySchema,
  createPartnerDeliveryDestinationSchema,
  updatePartnerDeliveryDestinationSchema,
} from "./partner-delivery-destinations.schema";

const partnerDeliveryDestinationsRouter = new Hono<{ Bindings: Env }>();

function getService(c: any) {
  return new PartnerDeliveryDestinationsService(c);
}

// 1. 一覧取得(partnerIdで絞り込み)
partnerDeliveryDestinationsRouter.get(
  "/",
  describeListRoute({
    summary: "取引先納品先一覧取得",
    tags: ["partner-delivery-destinations"],
    query: querySchema,
    itemDescription: "取引先納品先",
  }),
  async (c) => {
    try {
      const query = v.parse(querySchema, c.req.query());
      const result = await getService(c).getList(query);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// 2. 登録
partnerDeliveryDestinationsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "取引先納品先登録",
    tags: ["partner-delivery-destinations"],
    json: createPartnerDeliveryDestinationSchema,
    successDescription: "登録成功",
    errors: [{ status: 400, description: "取引先コードがマスタに存在しない" }],
  }),
  async (c) => {
    try {
      const body = await c.req.json();
      const validatedData = v.parse(createPartnerDeliveryDestinationSchema, body);
      const result = await getService(c).create(validatedData);
      return c.json(result);
    } catch (err) {
      if (isForeignKeyConstraintError(err)) {
        return c.json(
          { success: false, message: "登録エラー: 指定された取引先コードがマスタに存在しません" },
          400,
        );
      }
      return respondError(c, err);
    }
  },
);

// 3. 更新
partnerDeliveryDestinationsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "取引先納品先更新",
    tags: ["partner-delivery-destinations"],
    json: updatePartnerDeliveryDestinationSchema,
    successDescription: "更新成功",
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const validatedData = v.parse(updatePartnerDeliveryDestinationSchema, body);
      const result = await getService(c).update(id, validatedData);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// 3.5 無効化
partnerDeliveryDestinationsRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "取引先納品先無効化",
    tags: ["partner-delivery-destinations"],
    successDescription: "無効化成功",
    errors: [{ status: 404, description: "対象の納品先が見つからない" }],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const result = await getService(c).suspend(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// 4. 削除
partnerDeliveryDestinationsRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "取引先納品先削除",
    tags: ["partner-delivery-destinations"],
    successDescription: "削除成功",
    errors: [{ status: 400, description: "無効化済み以外は削除不可" }],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const result = await getService(c).delete(id);
      return c.json(result);
    } catch (err) {
      if (isForeignKeyConstraintError(err)) {
        return c.json(
          { success: false, message: "このデータは他の処理から参照されているため削除できません" },
          400,
        );
      }
      return respondError(c, err);
    }
  },
);

export { partnerDeliveryDestinationsRouter };
