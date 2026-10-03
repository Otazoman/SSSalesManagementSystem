import type { Context, Next } from "hono";
import type { Env } from "../../types/env";
import { clearSessionCookie, getSession, SESSION_MAX_AGE_SECONDS } from "./get-session";
import { LoginStateRepository } from "./login-state.repository";

// BUG-024: 署名付きのセッションcookieは、期限(24時間)まで有効なままになるため、
// アカウントの無効化・パスワードの変更・ログアウトの後も使えてしまっていた。
// ここで、セッションのユーザーが今も有効か、取り消しの時刻より後に発行されたものかを確かめる。

// ログインしていなくても使うAPI(Frontend Worker の PUBLIC_API_PATHS と同じ)。
// 取り消されたcookieが残っていても、cookieを消したうえでそのまま通す(ログイン画面などが使えなくならないように)
const PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/users/count",
  "/api/users/setup-admin",
  "/api/users/forgot-password",
  "/api/users/reset-password-via-token",
]);
const PUBLIC_PATH_PATTERN = /^\/api\/[a-z-]+\/download-(request|verify)\//;

const isPublicPath = (path: string) => PUBLIC_PATHS.has(path) || PUBLIC_PATH_PATTERN.test(path);

export async function sessionGuard(c: Context<{ Bindings: Env }>, next: Next) {
  const session = await getSession(c);
  if (!session) return next();

  // 発行時刻はcookieに持たせていないため、期限から逆算する(期限 = 発行時刻 + 24時間)
  const issuedAt = session.exp - SESSION_MAX_AGE_SECONDS;
  if (await new LoginStateRepository(c.env.DB).isSessionActive(session.userId, issuedAt)) return next();

  clearSessionCookie(c);
  if (isPublicPath(c.req.path)) return next();
  return c.json({ success: false, message: "ログインの有効期限が切れました。もう一度ログインしてください" }, 401);
}
