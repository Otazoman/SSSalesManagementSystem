// src/routes/admin/users/index.ts
import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { UserRepository } from "./user.repository";
import { UserService } from "./user.service";
import { PasswordService } from "./password.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { getSession } from "../../../platform/auth/get-session";
import { parsePaginationParams } from "../../../platform/http/pagination";
import {
  describeApiRoute,
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import {
  setupAdminSchema,
  userListQuerySchema,
  registerUserSchema,
  updateUserSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordViaTokenSchema,
  userIdParamSchema,
} from "./user.schema";
import { todayJst } from "../../../platform/date/format-jst-date";

const usersRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getRepo(c: any) {
  return new UserRepository(c.env.DB);
}
function getUserService(c: any) {
  return new UserService(getRepo(c), c.env);
}
function getPasswordService(c: any) {
  return new PasswordService(getRepo(c), c.env);
}

// 1. カウント
usersRouter.get(
  "/count",
  describeApiRoute({
    summary: "登録ユーザー数取得(初期セットアップ判定用)",
    tags: ["users"],
    responses: { 200: { description: "総ユーザー数" } },
  }),
  async (c) => {
  const repo = getRepo(c);
  const totalUsers = await repo.countUsers();
  return c.json({ totalUsers });
});

// 2. 初期セットアップ
usersRouter.post(
  "/setup-admin",
  describeMutationRoute({
    summary: "初期管理者セットアップ",
    tags: ["users"],
    json: setupAdminSchema,
    successDescription: "登録成功",
    errors: [{ status: 403, description: "初期セットアップトークンが正しくない" }],
  }),
  vValidator("json", setupAdminSchema, validationHook()),
  async (c) => {
    const service = getUserService(c);
    const body = c.req.valid("json");

    try {
      await service.setupInitialAdmin(c, body);
      return c.json({ success: true, message: "初期管理者を登録しました" });
    } catch (err) {
      return respondError(c, err, "初期化に失敗しました");
    }
  },
);

// 3. 一覧取得
usersRouter.get(
  "/",
  describeListRoute({
    summary: "ユーザー一覧取得",
    tags: ["users"],
    query: userListQuerySchema,
    itemDescription: "ユーザー(所属・権限マトリクス込み)",
  }),
  vValidator("query", userListQuerySchema, validationHook()),
  async (c) => {
    const service = getUserService(c);
    const query = c.req.valid("query");
    const rawQuery = c.req.query();
    if (rawQuery.page === undefined && rawQuery.limit === undefined) {
      const list = await service.getUserList(query);
      return c.json(list);
    }
    const params = parsePaginationParams(rawQuery);
    const result = await service.getUserListPage(query, params);
    return c.json(result);
  },
);

// 4. 個別登録
usersRouter.post(
  "/register",
  describeMutationRoute({
    summary: "ユーザー個別登録",
    tags: ["users"],
    json: registerUserSchema,
    successDescription: "登録成功",
  }),
  vValidator("json", registerUserSchema, validationHook()),
  async (c) => {
    const service = getUserService(c);
    const body = c.req.valid("json");

    try {
      await service.registerUser(c, body);
      return c.json({
        success: true,
        message: "ユーザーと所属・権限情報を登録しました",
      });
    } catch (err) {
      return respondError(c, err, "ユーザーの登録に失敗しました");
    }
  },
);

// 5. CSVダウンロード
usersRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "ユーザーマスタCSVダウンロード", tags: ["users"] }),
  vValidator("query", userListQuerySchema, validationHook()),
  async (c) => {
  const service = getUserService(c);
  try {
    const query = c.req.valid("query");
    const buffer = await service.exportCsvBuffer(c, query);

    return c.body(buffer, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="users_export_${todayJst()}.csv"`,
    });
  } catch (err) {
    return respondError(c, err, "CSV作成処理中にエラーが発生しました");
  }
});

// 6. CSV一括インポート
usersRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "ユーザーマスタCSV一括インポート(所属・権限含む)",
    tags: ["users"],
    successDescription: "同期成功",
    errors: [{ status: 400, description: "CSVファイル未添付" }],
  }),
  async (c) => {
  const service = getUserService(c);
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json(
        { success: false, message: "CSVファイルが添付されていません" },
        400,
      );
    }

    const count = await service.bulkRegisterFromCsv(c, file);
    return c.json({
      success: true,
      message: `CSVから ${count} 行の所属・配属権限データを完全同期しました`,
    });
  } catch (err) {
    return respondError(c, err,
      "インポート処理中にサーバー内部エラーが発生しました");
  }
});

// 7. 更新
usersRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "ユーザー情報更新",
    tags: ["users"],
    json: updateUserSchema,
    successDescription: "更新成功",
    errors: [{ status: 400, description: "無効なID形式" }],
  }),
  vValidator("param", userIdParamSchema, validationHook("無効なID形式です")),
  vValidator("json", updateUserSchema, validationHook()),
  async (c) => {
    const service = getUserService(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    // 操作者はブラウザが送る値ではなく、署名付きセッションcookieから決める(BUG-020)
    const operatorUserId = (await getSession(c))?.userId || "";

    try {
      await service.updateUserProfile(c, id, body, operatorUserId);
      return c.json({ success: true, message: "ユーザー情報を更新しました" });
    } catch (err) {
      return respondError(c, err, "ユーザー情報の更新に失敗しました");
    }
  },
);

// 8. 無効化
usersRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "ユーザー無効化",
    tags: ["users"],
    successDescription: "無効化成功(所属・権限も解除)",
    errors: [{ status: 400, description: "無効なID形式" }],
  }),
  vValidator("param", userIdParamSchema, validationHook("無効なID形式です")),
  async (c) => {
    const service = getUserService(c);
    const { id } = c.req.valid("param");
    // 操作者はブラウザが送る値ではなく、署名付きセッションcookieから決める(BUG-020)
    const operatorUserId = (await getSession(c))?.userId || "";

    try {
      await service.suspendUser(c, id, operatorUserId);
      return c.json({
        success: true,
        message: "ユーザーを無効化し、所属・権限を解除しました",
      });
    } catch (err) {
      return respondError(c, err, "無効化処理に失敗しました");
    }
  },
);

// 9. 物理消去
usersRouter.delete(
  "/:id/purge",
  describeDeleteRoute({
    summary: "ユーザー物理消去",
    tags: ["users"],
    successDescription: "消去成功",
    errors: [{ status: 400, description: "無効なID形式" }],
  }),
  vValidator("param", userIdParamSchema, validationHook("無効なID形式です")),
  async (c) => {
    const service = getUserService(c);
    const { id } = c.req.valid("param");
    // 操作者はブラウザが送る値ではなく、署名付きセッションcookieから決める(BUG-020)
    const operatorUserId = (await getSession(c))?.userId || "";

    try {
      await service.purgeUser(c, id, operatorUserId);
      return c.json({
        success: true,
        message: "ユーザーアカウントを完全に消去しました",
      });
    } catch (err) {
      return respondError(c, err, "ユーザーの削除に失敗しました");
    }
  },
);

// 10. パスワード変更
usersRouter.post(
  "/change-password",
  describeMutationRoute({
    summary: "パスワード変更",
    tags: ["users"],
    json: changePasswordSchema,
    successDescription: "変更成功",
  }),
  vValidator("json", changePasswordSchema, validationHook()),
  async (c) => {
    const service = getPasswordService(c);
    const body = c.req.valid("json");

    try {
      await service.changePassword(c, body);
      return c.json({ success: true, message: "正常に更新しました" });
    } catch (err) {
      return respondError(c, err, "パスワードの変更に失敗しました");
    }
  },
);

// 11. パスワードリセット要求
usersRouter.post(
  "/forgot-password",
  describeMutationRoute({
    summary: "パスワード再設定要求(メール送信)",
    tags: ["users"],
    json: forgotPasswordSchema,
    successDescription: "送信成功",
  }),
  vValidator("json", forgotPasswordSchema, validationHook()),
  async (c) => {
    const service = getPasswordService(c);
    const { email } = c.req.valid("json");

    try {
      await service.forgotPassword(c, email);
      return c.json({
        success: true,
        message: "入力されたメールアドレス宛に再設定の案内の送信を予約しました",
      });
    } catch (err) {
      return respondError(c, err, "処理中にエラーが発生しました");
    }
  },
);

// 12. トークン経由のリセット
usersRouter.post(
  "/reset-password-via-token",
  describeMutationRoute({
    summary: "トークン経由のパスワード再設定",
    tags: ["users"],
    json: resetPasswordViaTokenSchema,
    successDescription: "再設定成功",
    errors: [{ status: 400, description: "URLの有効期限切れ、または既に利用済み" }],
  }),
  vValidator("json", resetPasswordViaTokenSchema, validationHook()),
  async (c) => {
    const service = getPasswordService(c);
    const body = c.req.valid("json");

    try {
      await service.resetPasswordViaToken(c, body);
      return c.json({
        success: true,
        message:
          "パスワードを正常に更新しました。新しいパスワードでログインしてください。",
      });
    } catch (err) {
      return respondError(c, err, "再設定処理に失敗しました");
    }
  },
);

export { usersRouter };
