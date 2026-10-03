import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { AccountsRepository } from "./accounts.repository";
import { AccountsService } from "./accounts.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  GetAccountsQuerySchema,
  RegisterAccountBodySchema,
  UpdateAccountBodySchema,
  CodeParamSchema,
} from "./accounts.schema";

const accountsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  const repo = new AccountsRepository(c.env.DB);
  return new AccountsService(repo);
}

// 1. 一覧取得
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
accountsRouter.get(
  "/",
  describeListRoute({
    summary: "勘定科目マスタ一覧取得",
    tags: ["accounts"],
    query: GetAccountsQuerySchema,
    itemDescription: "勘定科目マスタ",
  }),
  vValidator("query", GetAccountsQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const rawQuery = c.req.query();
      const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
      if (rawQuery.page === undefined && rawQuery.limit === undefined) {
        const result = await service.getAccounts(query, sort);
        return c.json(result);
      }
      const params = parsePaginationParams(rawQuery);
      const result = await service.getAccountsPage(query, params, sort);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 2. 新規登録
accountsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "勘定科目マスタ新規登録",
    tags: ["accounts"],
    json: RegisterAccountBodySchema,
    successDescription: "仮登録成功(有効化には申請承認が必要)",
  }),
  vValidator("json", RegisterAccountBodySchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.registerAccount(c, body);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 3. 更新
accountsRouter.put(
  "/:code",
  describeMutationRoute({
    summary: "勘定科目マスタ更新",
    tags: ["accounts"],
    json: UpdateAccountBodySchema,
    successDescription: "更新成功",
  }),
  vValidator("param", CodeParamSchema, validationHook()),
  vValidator("json", UpdateAccountBodySchema, validationHook()),
  async (c) => {
    try {
      const { code } = c.req.valid("param");
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.updateAccount(c, code, body);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 3.5 無効化 (POST /:code/suspend)
accountsRouter.post(
  "/:code/suspend",
  describeMutationRoute({
    summary: "勘定科目マスタ無効化",
    tags: ["accounts"],
    successDescription: "無効化成功",
  }),
  vValidator("param", CodeParamSchema, validationHook()),
  async (c) => {
    try {
      const { code } = c.req.valid("param");
      const service = getService(c);
      const result = await service.suspendAccount(c, code);
      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 4. 削除
accountsRouter.delete(
  "/:code",
  describeDeleteRoute({
    summary: "勘定科目マスタ削除",
    tags: ["accounts"],
    successDescription: "削除成功",
    errors: [
      { status: 400, description: "有効は直接削除不可、または他データから参照されているため削除不可" },
    ],
  }),
  vValidator("param", CodeParamSchema, validationHook()),
  async (c) => {
    try {
      const { code } = c.req.valid("param");
      const service = getService(c);
      const result = await service.deleteAccount(c, code);

      return c.json(result);
    } catch (e) {
      return respondError(c, e);
    }
  },
);

// 5. CSVダウンロード
accountsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "勘定科目マスタCSVダウンロード", tags: ["accounts"] }),
  vValidator("query", GetAccountsQuerySchema, validationHook()),
  async (c) => {
  try {
    const query = c.req.valid("query");
    const service = getService(c);
    const csvContent = await service.downloadCsv(c, query);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="accounts.csv"`,
    });
  } catch (e) {
    return respondError(c, e);
  }
});

// 6. CSV一括同期
accountsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "勘定科目マスタCSV一括同期",
    tags: ["accounts"],
    successDescription: "同期成功",
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

    const text = await file.text();
    const service = getService(c);
    const result = await service.bulkRegisterCsv(c, text);
    return c.json(result);
  } catch (e) {
    return respondError(c, e);
  }
});

export { accountsRouter };
