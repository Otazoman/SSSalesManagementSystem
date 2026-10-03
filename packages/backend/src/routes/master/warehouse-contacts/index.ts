import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { WarehouseContactsService } from "./warehouse-contacts.service";
import { respondError } from "../../../platform/http/error-handler";
import { isForeignKeyConstraintError } from "../../../platform/http/http-error";
import {
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
} from "../../../platform/openapi/describe-route";
import {
  querySchema,
  createWarehouseContactSchema,
  updateWarehouseContactSchema,
} from "./warehouse-contacts.schema";

const warehouseContactsRouter = new Hono<{ Bindings: Env }>();

function getService(c: any) {
  return new WarehouseContactsService(c);
}

// 1. 一覧取得 (warehouseIdで絞り込み)
warehouseContactsRouter.get(
  "/",
  describeListRoute({
    summary: "倉庫連絡先一覧取得",
    tags: ["warehouse-contacts"],
    query: querySchema,
    itemDescription: "倉庫連絡先",
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
warehouseContactsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "倉庫連絡先登録",
    tags: ["warehouse-contacts"],
    json: createWarehouseContactSchema,
    successDescription: "登録成功",
    errors: [{ status: 400, description: "倉庫コードがマスタに存在しない" }],
  }),
  async (c) => {
    try {
      const body = await c.req.json();
      const validatedData = v.parse(createWarehouseContactSchema, body);
      const result = await getService(c).create(validatedData);
      return c.json(result);
    } catch (err) {
      if (isForeignKeyConstraintError(err)) {
        return c.json(
          { success: false, message: "登録エラー: 指定された倉庫コードがマスタに存在しません" },
          400,
        );
      }
      return respondError(c, err);
    }
  },
);

// 3. 更新
warehouseContactsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "倉庫連絡先更新",
    tags: ["warehouse-contacts"],
    json: updateWarehouseContactSchema,
    successDescription: "更新成功",
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const validatedData = v.parse(updateWarehouseContactSchema, body);
      const result = await getService(c).update(id, validatedData);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// 3.5 無効化
warehouseContactsRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "倉庫連絡先無効化",
    tags: ["warehouse-contacts"],
    successDescription: "無効化成功",
    errors: [{ status: 404, description: "対象の連絡先が見つからない" }],
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
warehouseContactsRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "倉庫連絡先削除",
    tags: ["warehouse-contacts"],
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

export { warehouseContactsRouter };
