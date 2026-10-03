import { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { Env } from "../../types/env";
import { SessionPayload, signSessionToken, verifySessionToken } from "./session-token";

export const SESSION_COOKIE_NAME = "session_token";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

// 本番(https)ではsecure cookieを強制し、ローカル開発(http)では無効化する。
function isSecureContext(env: Env): boolean {
  return (env.FRONTEND_URL || "").startsWith("https://");
}

// Secrets Store未設定・取得失敗時はnullを返す(呼び出し元で「未ログイン扱い」にする)
async function readSessionSecret(env: Env): Promise<string | null> {
  try {
    return await env.SESSION_SECRET.get();
  } catch {
    return null;
  }
}

// 署名付きセッションcookieを検証し、有効であればペイロードを返す。
// auth機能に限らず、リクエストの実行者を必要とするあらゆる場所(監査ログ等)から呼び出せる共通口。
export async function getSession(
  c: Context<{ Bindings: Env }>,
): Promise<SessionPayload | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  const secret = await readSessionSecret(c.env);
  if (!secret) return null;
  return verifySessionToken(token, secret);
}

export async function setSessionCookie(
  c: Context<{ Bindings: Env }>,
  payload: Omit<SessionPayload, "exp">,
): Promise<void> {
  // ログイン成立時にSESSION_SECRETが取得できないのは設定不備のため、ここは例外のまま伝播させる
  // (未検証のcookieを発行してしまうより、ログインごと失敗させるほうが安全)
  const secret = await c.env.SESSION_SECRET.get();
  const token = await signSessionToken(
    payload,
    secret,
    SESSION_MAX_AGE_SECONDS,
  );
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureContext(c.env),
    sameSite: "Lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export function clearSessionCookie(c: Context<{ Bindings: Env }>): void {
  setCookie(c, SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: isSecureContext(c.env),
    sameSite: "Lax",
    maxAge: 0,
    path: "/",
  });
}

// company-settings更新時など、ログイン中のセッションの一部フィールドだけを書き換えて再署名する。
// 未ログイン状態(cookieなし/検証失敗)の場合は何もしない。
export async function refreshSessionCookie(
  c: Context<{ Bindings: Env }>,
  updates: Partial<Omit<SessionPayload, "userId" | "employeeNumber" | "exp">>,
): Promise<void> {
  const current = await getSession(c);
  if (!current) return;
  const { exp: _exp, ...rest } = current;
  await setSessionCookie(c, { ...rest, ...updates });
}
