// 使用マニュアルの撮影・サンプルデータ取込の共通設定。
// ログイン情報はリポジトリのルートの .env(Git 管理外)から読む。値はログ・ファイルに一切出力しない。
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
export const MANUAL_DIR = resolve(REPO_ROOT, "docs/manual");
export const IMAGES_DIR = resolve(MANUAL_DIR, "images");

/** 撮影先の URL。既定は Staging。ローカルで撮る場合は MANUAL_BASE_URL=http://localhost:8788 を指定する */
export const BASE_URL = (process.env.MANUAL_BASE_URL || "https://my-erp-frontend-staging.tohonokai.workers.dev").replace(/\/$/, "");

/** .env の KEY=VALUE を読む(# から始まる行・空行は無視。値の前後の引用符は外す) */
export function readDotEnv(path = resolve(REPO_ROOT, ".env")) {
  if (!existsSync(path)) throw new Error(`${path} がありません`);
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

/**
 * 撮影に使うログイン情報。prefix は MANUAL(管理者・既定)・MANUAL_APPLICANT(申請する一般社員)・
 * MANUAL_APPROVER(承認する上長)。.env の <prefix>_USER・<prefix>_PASSWORD を読む
 */
export function readCredentials(prefix = "MANUAL") {
  const env = { ...readDotEnv(), ...process.env };
  const user = env[`${prefix}_USER`];
  const password = env[`${prefix}_PASSWORD`];
  if (!user || !password) {
    throw new Error(`.env に ${prefix}_USER と ${prefix}_PASSWORD を「キー=値」の形で書いてください(値は表示されません)`);
  }
  return { user, password };
}

/** API でログインし、セッション cookie(session_token)の値を返す */
export async function loginForCookie(prefix = "MANUAL") {
  const { user, password } = readCredentials(prefix);
  const body = user.includes("@") ? { email: user, password } : { employeeNumber: user, password };
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ログインに失敗しました(${res.status})`);
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  const token = setCookie.map((c) => /session_token=([^;]+)/.exec(c)?.[1]).find(Boolean);
  if (!token) throw new Error("ログインの応答にセッション cookie がありません");
  return token;
}

/**
 * キャプチャに写してはいけない語(実際のドメインなど)。スクリプトに書くとリポジトリに残るため、
 * ログイン用メールアドレス(管理者・申請者・承認者)のドメイン・撮影先の URL から自動で決め、追加分は .env の MANUAL_MASK_WORDS(カンマ区切り)に書く
 */
export function readMaskWords() {
  const env = { ...readDotEnv(), ...process.env };
  const words = new Set();
  for (const key of ["MANUAL_USER", "MANUAL_APPLICANT_USER", "MANUAL_APPROVER_USER"]) {
    const domain = (env[key] || "").split("@")[1];
    if (domain) words.add(domain.split(".")[0]);
  }
  const host = new URL(BASE_URL).hostname;
  if (host.endsWith(".workers.dev")) words.add(host.split(".").slice(-3, -2)[0]); // <サブドメイン>.workers.dev
  for (const w of (env.MANUAL_MASK_WORDS || "").split(",")) if (w.trim()) words.add(w.trim());
  // 英数字とハイフンだけの語に限る(撮影スクリプトで、そのまま正規表現に入れるため)
  return [...words].filter((w) => /^[A-Za-z0-9-]{3,}$/.test(w) && !/^(localhost|example)$/i.test(w));
}
