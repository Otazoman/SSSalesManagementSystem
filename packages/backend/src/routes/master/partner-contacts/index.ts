import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { PartnerContactsService } from "./partner-contacts.service";
import { respondError } from "../../../platform/http/error-handler";
import { isForeignKeyConstraintError } from "../../../platform/http/http-error";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  querySchema,
  createContactSchema,
  updateContactSchema,
} from "./partner-contacts.schema";

const partnerContactsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new PartnerContactsService(c);
}

// 1. 一覧取得
partnerContactsRouter.get(
  "/",
  describeListRoute({
    summary: "取引先担当者一覧取得",
    tags: ["partner-contacts"],
    query: querySchema,
    itemDescription: "取引先担当者",
  }),
  async (c) => {
  try {
    const rawQuery = {
      partnerId: c.req.query("partnerId") || c.req.query("customerId"),
      name: c.req.query("name"),
      status: c.req.query("status"),
      sortBy: c.req.query("sortBy"),
      sortOrder: c.req.query("sortOrder"),
    };
    const query = v.parse(querySchema, rawQuery);

    const service = getService(c);
    const rawPagination = c.req.query();
    const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
    if (rawPagination.page === undefined && rawPagination.limit === undefined) {
      const result = await service.getList(query, sort);
      return c.json(result);
    }
    const params = parsePaginationParams(rawPagination);
    const result = await service.getListPage(query, params, sort);
    return c.json(result);
  } catch (err) {
    return respondError(c, err);
  }
});

// 2. 個別登録
partnerContactsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "取引先担当者個別登録",
    tags: ["partner-contacts"],
    json: createContactSchema,
    successDescription: "登録成功",
    errors: [{ status: 400, description: "取引先コードまたは自社ユーザーIDがマスタに存在しない" }],
  }),
  async (c) => {
  try {
    const body = await c.req.json();
    const validatedData = v.parse(createContactSchema, body);

    const service = getService(c);
    const result = await service.create(validatedData);
    return c.json(result);
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return c.json(
        {
          success: false,
          message:
            "登録エラー: 指定された取引先コード、または自社ユーザーIDがマスタに存在しないため紐付けできません",
        },
        400,
      );
    }
    return respondError(c, err);
  }
});

// 3. 更新
partnerContactsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "取引先担当者更新",
    tags: ["partner-contacts"],
    json: updateContactSchema,
    successDescription: "更新成功",
  }),
  async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validatedData = v.parse(updateContactSchema, body);

    const service = getService(c);
    const result = await service.update(id, validatedData);
    return c.json(result);
  } catch (err) {
    return respondError(c, err);
  }
});

// 3.5 無効化
partnerContactsRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "取引先担当者無効化",
    tags: ["partner-contacts"],
    successDescription: "無効化成功",
    errors: [{ status: 404, description: "対象の担当者が見つからない" }],
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const service = getService(c);
      const result = await service.suspend(id);
      return c.json(result);
    } catch (err) {
      return respondError(c, err);
    }
  },
);

// 4. 削除
partnerContactsRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "取引先担当者削除",
    tags: ["partner-contacts"],
    successDescription: "削除成功",
    errors: [{ status: 400, description: "他データから参照されているため削除不可" }],
  }),
  async (c) => {
  try {
    const id = c.req.param("id");
    const service = getService(c);
    const result = await service.delete(id);
    return c.json(result);
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return c.json(
        {
          success: false,
          message: "このデータは他の処理から参照されているため削除できません",
        },
        400,
      );
    }
    return respondError(c, err);
  }
});

// 5. CSV一括ダウンロード
partnerContactsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "取引先担当者CSV一括ダウンロード", tags: ["partner-contacts"] }),
  async (c) => {
  try {
    const rawQuery = {
      partnerId: c.req.query("partnerId") || c.req.query("customerId"),
      name: c.req.query("name"),
      status: c.req.query("status"),
    };
    const query = v.parse(querySchema, rawQuery);

    const service = getService(c);
    const csvContent = await service.downloadCsv(query);

    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts.csv"`,
    });
  } catch (err) {
    return respondError(c, err);
  }
});

// 6. CSV一括流し込み
partnerContactsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "取引先担当者CSV一括流し込み",
    tags: ["partner-contacts"],
    successDescription: "取り込み成功",
    errors: [{ status: 400, description: "ファイル未添付、または親マスタ未登録によるデータ整合性エラー" }],
  }),
  async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json(
        { success: false, message: "ファイルが添付されていません" },
        400,
      );
    }

    const service = getService(c);
    const result = await service.bulkRegister(file);
    return c.json(result);
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return c.json(
        {
          success: false,
          message:
            "取引先マスタまたは自社ユーザーマスタに登録されていないIDが含まれているため、データ整合性エラーにより取り込みを中断しました。先に親マスタの登録を行ってください。",
        },
        400,
      );
    }
    return respondError(c, err);
  }
});

export { partnerContactsRouter };
