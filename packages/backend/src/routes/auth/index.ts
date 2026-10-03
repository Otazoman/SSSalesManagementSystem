import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../types/env";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { respondError, validationHook } from "../../platform/http/error-handler";
import { loginSchema, updateNotificationSettingsSchema } from "./auth.schema";
import { getSession } from "../../platform/auth/get-session";

const authRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  const repo = new AuthRepository(c.env.DB);
  return new AuthService(repo, c.env);
}

// 1. ログイン
authRouter.post(
  "/login",
  vValidator("json", loginSchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);

      const result = await service.login(c, body);
      return c.json(result.data, result.status as any);
    } catch (err) {
      return respondError(c, err, "サーバー内部でエラーが発生しました");
    }
  },
);

// 2. プロフィール取得
authRouter.get("/profile", async (c) => {
  try {
    const session = await getSession(c);

    const service = getService(c);

    const result = await service.getProfile(c, session);
    return c.json(result.data, result.status as any);
  } catch (err) {
    return respondError(c, err, "プロフィールの取得に失敗しました");
  }
});

// 3. 通知設定の自己編集(プロフィール画面: SlackメンバーID・通知方法)
authRouter.put(
  "/profile/notification-settings",
  vValidator("json", updateNotificationSettingsSchema, validationHook()),
  async (c) => {
    try {
      const session = await getSession(c);
      const body = c.req.valid("json");
      const service = getService(c);

      const result = await service.updateNotificationSettings(
        c,
        session,
        body,
      );
      return c.json(result.data, result.status as any);
    } catch (err) {
      return respondError(c, err, "通知設定の更新に失敗しました");
    }
  },
);

// 4. ログアウト
authRouter.post("/logout", async (c) => {
  try {
    const service = getService(c);
    const result = await service.logout(c);
    return c.json(result.data, result.status as any);
  } catch (err) {
    return respondError(c, err, "ログアウト処理に失敗しました");
  }
});

export { authRouter };
