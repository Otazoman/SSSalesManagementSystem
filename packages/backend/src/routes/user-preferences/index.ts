import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../types/env";
import { DEFAULT_PREFERENCES, UserPreferencesPayloadSchema } from "./user-preferences.schema";
import { getSession } from "../../platform/auth/get-session";
import { respondError, respondValidationError } from "../../platform/http/error-handler";
import { describeApiRoute } from "../../platform/openapi/describe-route";
import { UserPreferencesRepository } from "./user-preferences.repository";

// 自分の表示設定だけを読み書きする(他のユーザーの設定は扱えない。ユーザーIDは必ずセッションから取る)
const userPreferencesRouter = new Hono<{ Bindings: Env }>();

userPreferencesRouter.onError((err, c) => respondError(c, err));

const unauthorized = (c: any) => c.json({ success: false, message: "ログインが必要です" }, 401);

userPreferencesRouter.get(
  "/",
  describeApiRoute({
    summary: "自分の表示設定(色・ダークモード)",
    tags: ["user-preferences"],
    responses: { 200: { description: "{themeMode, accentColor}。未設定なら既定値" }, 401: { description: "未ログイン" } },
  }),
  async (c) => {
    const session = await getSession(c);
    if (!session) return unauthorized(c);
    const repo = new UserPreferencesRepository(c.env.DB_UI);
    const row = await repo.findByUserId(session.userId);
    return c.json(row ? { themeMode: row.themeMode, accentColor: row.accentColor } : DEFAULT_PREFERENCES);
  },
);

userPreferencesRouter.put(
  "/",
  describeApiRoute({
    summary: "自分の表示設定を保存",
    tags: ["user-preferences"],
    json: UserPreferencesPayloadSchema,
    responses: { 200: { description: "保存した設定" }, 400: { description: "入力不正" }, 401: { description: "未ログイン" } },
  }),
  async (c) => {
    const session = await getSession(c);
    if (!session) return unauthorized(c);
    const parsed = v.safeParse(UserPreferencesPayloadSchema, await c.req.json());
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const repo = new UserPreferencesRepository(c.env.DB_UI);
    await repo.upsert(session.userId, parsed.output);
    return c.json(parsed.output);
  },
);

export { userPreferencesRouter };
