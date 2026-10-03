import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { PartnersService } from "./partners.service";
import { respondError } from "../../../platform/http/error-handler";
import { isForeignKeyConstraintError } from "../../../platform/http/http-error";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeListRoute,
  describeMutationRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  querySchema,
  createPartnerSchema,
  updatePartnerSchema,
} from "./partners.schema";

const partnersRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new PartnersService(c);
}

// 1. 一覧取得（💡 パスを "/" に修正）
partnersRouter.get(
  "/",
  describeListRoute({
    summary: "取引先マスタ一覧取得",
    tags: ["partners"],
    query: querySchema,
    itemDescription: "取引先マスタ(添付ファイル込み)",
  }),
  async (c) => {
  try {
    const rawQuery = {
      id: c.req.query("id"),
      name: c.req.query("name"),
      nameMode: c.req.query("nameMode"),
      type: c.req.query("type"),
      status: c.req.query("status"),
      sortBy: c.req.query("sortBy"),
      sortOrder: c.req.query("sortOrder"),
    };
    const query = v.parse(querySchema, rawQuery);

    const service = getService(c);
    const rawPagination = c.req.query();
    const sort = { sortBy: query.sortBy ?? undefined, sortOrder: query.sortOrder ?? undefined };
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
partnersRouter.post(
  "/register",
  describeMutationRoute({
    summary: "取引先マスタ個別登録",
    tags: ["partners"],
    json: createPartnerSchema,
    successDescription: "登録成功",
    errors: [{ status: 400, description: "重複または不正な入力値" }],
  }),
  async (c) => {
  try {
    const body = await c.req.json();
    const validatedData = v.parse(createPartnerSchema, body);

    const service = getService(c);
    const result = await service.create(validatedData);
    return c.json(result);
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return c.json(
        {
          success: false,
          message: "登録エラー: 重複または不正な入力値が存在します",
        },
        400,
      );
    }
    return respondError(c, err);
  }
});

// 3. 更新
partnersRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "取引先マスタ更新",
    tags: ["partners"],
    json: updatePartnerSchema,
    successDescription: "更新成功",
  }),
  async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const validatedData = v.parse(updatePartnerSchema, body);

    const service = getService(c);
    const result = await service.update(id, validatedData);
    return c.json(result);
  } catch (err) {
    return respondError(c, err);
  }
});

// 4. 取引停止処理
partnersRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "取引先取引停止処理",
    tags: ["partners"],
    successDescription: "停止成功",
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
});

// 5. 物理削除 (purge)
partnersRouter.delete(
  "/:id/purge",
  describeApiRoute({
    summary: "取引先マスタ物理削除",
    tags: ["partners"],
    responses: {
      200: { description: "削除成功" },
      400: { description: "担当者や他データから参照されているため削除不可" },
    },
  }),
  async (c) => {
  try {
    const id = c.req.param("id");
    const service = getService(c);
    const result = await service.purge(id);
    return c.json(result);
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return c.json(
        {
          success: false,
          message:
            "この取引先は担当者や他データから参照されているため削除できません",
        },
        400,
      );
    }
    return respondError(c, err);
  }
});

// 6. CSV一括ダウンロード
partnersRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "取引先マスタCSV一括ダウンロード", tags: ["partners"] }),
  async (c) => {
  try {
    const rawQuery = {
      id: c.req.query("id"),
      name: c.req.query("name"),
      nameMode: c.req.query("nameMode"),
      type: c.req.query("type"),
      status: c.req.query("status"),
    };
    const query = v.parse(querySchema, rawQuery);

    const service = getService(c);
    const csvContent = await service.downloadCsv(query);

    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="partners.csv"`,
    });
  } catch (err) {
    return respondError(c, err);
  }
});

// 7. CSV一括流し込み
partnersRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "取引先マスタCSV一括流し込み",
    tags: ["partners"],
    successDescription: "取り込み成功",
    errors: [{ status: 400, description: "ファイル未添付" }],
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
    return respondError(c, err);
  }
});

// 8. ファイルアップロード専用API
partnersRouter.post(
  "/upload",
  describeApiRoute({
    summary: "取引先マスタ添付ファイルアップロード",
    tags: ["partners"],
    responses: {
      200: { description: "アップロード成功" },
      400: { description: "ファイルが見つからない" },
    },
  }),
  async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json({ success: false, message: "ファイルがありません" }, 400);
    }

    const service = getService(c);
    const result = await service.uploadFile(file);
    return c.json(result);
  } catch (err) {
    return respondError(c, err);
  }
});

// 9. ファイル配信用API(DB経由: partnerId + attachmentId で解決)
partnersRouter.get(
  "/files/:partnerId/:attachmentId",
  describeApiRoute({
    summary: "取引先マスタ添付ファイル配信",
    tags: ["partners"],
    responses: {
      200: { description: "ファイル本体、または外部リンクへのリダイレクト" },
      404: { description: "ファイルが見つからない" },
    },
  }),
  async (c) => {
  try {
    const partnerId = c.req.param("partnerId");
    const attachmentId = c.req.param("attachmentId");
    const service = getService(c);
    const fileResult = await service.getFile(partnerId, attachmentId);

    if (!fileResult) {
      return c.text("ファイルが見つかりません", 404);
    }

    if (fileResult.type === "redirect") {
      return c.redirect(fileResult.redirectUrl);
    }

    return new Response(fileResult.body, {
      headers: {
        "content-type": fileResult.contentType,
        "content-disposition": fileResult.contentDisposition,
      },
    });
  } catch (err) {
    return respondError(c, err, "ファイルの取得に失敗しました");
  }
});

export { partnersRouter };
