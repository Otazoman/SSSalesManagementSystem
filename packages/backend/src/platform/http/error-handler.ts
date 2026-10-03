import type { Context, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as v from "valibot";
import { isHttpError } from "./http-error";

/**
 * 500エラー用の共通レスポンス生成 + ログ出力。
 * 各Routeのtry/catchから呼ぶ(customMessageで文脈に応じたメッセージを指定可能)ほか、
 * どこにもcatchが無かった場合の最終防波堤としてHonoのapp.onErrorからも呼ぶ。
 *
 * BUG-025: 以前はエラーの名前・メッセージ・スタックトレース(DBのエラーならSQL文)をブラウザに返していた。
 * 攻撃者にシステムの内部の作りを知る手がかりを与えるため、応答には利用者向けのメッセージと
 * 問い合わせ用の番号(errorId)だけを返し、詳細はその番号を付けてログにだけ出す
 * (`wrangler tail` のログを errorId で探せば、原因を調べられる)。
 */
export function handleServerError(
  c: Context,
  err: unknown,
  customMessage = "内部サーバーエラーが発生しました",
) {
  const errorObj = err instanceof Error ? err : new Error(String(err));
  const errorId = crypto.randomUUID().slice(0, 8);

  console.error(
    `[500] errorId=${errorId} ${c.req.method} ${c.req.path} -`,
    errorObj.name,
    errorObj.message,
    errorObj.stack ?? null,
  );

  return c.json(
    {
      success: false,
      message: `${customMessage}(問い合わせ番号: ${errorId})`,
      errorId,
    },
    500,
  );
}

/**
 * BUG-041: APIのエラー応答を1か所で作る。各Routeのcatch・Routerの`onError`・`app.onError`は全てこれを呼ぶ。
 * - 入力チェック(valibot)のエラー → 400。`errors`に項目ごとの内容を付ける
 * - 業務エラー(HttpError: BadRequestError など) → そのステータスで、利用者向けの`message`を返す
 * - それ以外(想定外のエラー) → 500。`fallbackMessage`と問い合わせ番号だけを返す(handleServerError)
 *
 * 応答の形は全て`{ success: false, message }`にそろえる。想定外のエラーの`err.message`は画面に出さない
 * (DBのエラー文などが含まれうるため。BUG-025)。
 */
export function respondError(c: Context, err: unknown, fallbackMessage?: string) {
  if (v.isValiError(err)) {
    return respondValidationError(c, err.issues);
  }
  if (isHttpError(err)) {
    return c.json({ success: false, message: err.message }, err.status as ContentfulStatusCode);
  }
  return handleServerError(c, err, fallbackMessage);
}

/**
 * BUG-041: vValidator の入力チェックで不備があった時の応答を、respondError の入力チェックのエラーと同じ形にそろえる。
 * `vValidator("json", schema, validationHook())` のように全ての vValidator に付ける
 * (付けないと valibot-validator の既定の形 `{ success, issues, ... }` になり、message が無い)。
 * 何が不備かを特定して伝えられる場合(例: IDの形式)だけ message を渡す。
 */
export function validationHook(message?: string) {
  // Context の型引数を固定すると、vValidator が推論するパスの型(c.req.param の型)が崩れるため、ジェネリックにする
  return <E extends Env, P extends string>(
    result: { success: boolean; issues?: readonly { message: string }[] },
    c: Context<E, P>,
  ) => {
    if (!result.success) {
      return respondValidationError(c, result.issues ?? [], message);
    }
  };
}

/**
 * 入力チェックのエラー(400)の応答。`v.safeParse` の結果を自分で判定する場合も、`c.json` で組み立てずにこれを使う
 * (`if (!parsed.success) return respondValidationError(c, parsed.issues);`)。
 */
export function respondValidationError(c: Context, issues: readonly { message: string }[], message?: string) {
  return c.json({ success: false, message: message ?? validationMessage(issues), errors: issues }, 400);
}

/**
 * BUG-041: 本文の JSON が壊れているリクエストを、各 API の処理の前に 400 で返す(src/index.ts で使う)。
 * 各 API の `c.req.json()` は try の外にあることが多く、壊れていると想定外のエラー(500)になっていた。
 * Hono は読み取った本文を覚えておくため、ここで読んでも各 API の `c.req.json()`・vValidator はそのまま使える。
 */
export async function rejectMalformedJson(c: Context, next: () => Promise<void>) {
  if (["POST", "PUT", "PATCH"].includes(c.req.method) && c.req.header("content-type")?.includes("application/json")) {
    // 本文が空のもの(Content-Type だけ付けて本文を送らない画面がありうる)は、今までどおり各 API に任せる
    const text = await c.req.raw.clone().text();
    if (text.trim() !== "") {
      try {
        await c.req.json();
      } catch {
        return c.json({ success: false, message: "リクエストの形式が正しくありません" }, 400);
      }
    }
  }
  await next();
}

/**
 * 入力チェックのエラーで画面に出す文言。スキーマに日本語の文言を書いてある場合(例: 「初期セットアップトークンは必須です」)は
 * 最初の不備の文言を、無い場合(valibot の既定の英語の文言)は共通の文言を使う。
 */
function validationMessage(issues: readonly { message: string }[] | undefined): string {
  const first = issues?.[0]?.message;
  return first && /[^\x00-\x7F]/.test(first) ? first : "入力内容に不備があります";
}
