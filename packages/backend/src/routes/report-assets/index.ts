import { Hono } from "hono";
import { Env } from "../../types/env";
import { getSession } from "../../platform/auth/get-session";
import { respondError } from "../../platform/http/error-handler";
import { describeApiRoute } from "../../platform/openapi/describe-route";

// PERF-07 B-2: ブラウザで帳票 PDF を作るための、フォント・ロゴ・社印を返す API(ログインが必要)。
// R2(SYSTEM_BUCKET)のオブジェクトを読み込まずにそのまま流す(arrayBuffer にしない。Worker の CPU 時間を使わないため)。
// ETag を付け、ブラウザは保存した ETag を If-None-Match で送って変わっていないかを確かめる(変わっていなければ 304)。
// Cache-Control は no-cache(使う前に毎回確かめる)にし、フォントなどを差し替えたら、次の発行から新しいものが使われるようにする。
const reportAssetsRouter = new Hono<{ Bindings: Env }>();

reportAssetsRouter.onError((err, c) => respondError(c, err));

// 今の PDF の処理(各 *-pdf.service.ts)が読んでいる場所と同じ
const REPORT_ASSETS: Record<string, { key: string; contentType: string }> = {
  font: { key: "fonts/company_fonts.ttf", contentType: "font/ttf" },
  logo: { key: "company/company_logo.png", contentType: "image/png" },
  seal: { key: "company/company_seal.png", contentType: "image/png" },
};

// If-None-Match の値(W/ 付き・複数指定を含む)から、R2 の比較に使う ETag を取り出す
function parseIfNoneMatch(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const first = header.split(",")[0].trim().replace(/^W\//, "");
  return first.replace(/^"|"$/g, "") || undefined;
}

reportAssetsRouter.get(
  "/:name",
  describeApiRoute({
    summary: "帳票の描画に使うフォント・ロゴ・社印(name は font・logo・seal)",
    tags: ["report-assets"],
    responses: {
      200: { description: "ファイルの中身(ETag・Cache-Control 付き)" },
      304: { description: "If-None-Match の ETag から変わっていない" },
      401: { description: "未ログイン" },
      404: { description: "名前が違う、または登録されていない(ロゴ・社印は未登録のことがある)" },
    },
  }),
  async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ success: false, message: "ログインが必要です" }, 401);

    const asset = REPORT_ASSETS[c.req.param("name")];
    if (!asset) return c.json({ success: false, message: "対象のファイルがありません" }, 404);

    const etagToSkip = parseIfNoneMatch(c.req.header("If-None-Match"));
    const object = await c.env.SYSTEM_BUCKET.get(
      asset.key,
      etagToSkip ? { onlyIf: { etagDoesNotMatch: etagToSkip } } : undefined,
    );
    if (!object) return c.json({ success: false, message: "対象のファイルが登録されていません" }, 404);

    const headers = new Headers({
      "Content-Type": asset.contentType,
      ETag: object.httpEtag,
      "Cache-Control": "private, no-cache",
    });
    // onlyIf の条件に合わない(=ETag が同じ)時は、中身の無いオブジェクトが返る
    if (!("body" in object) || !object.body) {
      return new Response(null, { status: 304, headers });
    }
    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  },
);

export { reportAssetsRouter };
