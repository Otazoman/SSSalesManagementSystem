import type { Context, Next } from "hono";

// BUG-023: 添付ファイル・帳票などのファイルの応答を、ブラウザで安全に扱われる形にそろえる。
// アップロード時にはファイルの種類を確かめない(ユーザー決定 2026-09-28)ため、返す時に次を行う:
//   - ブラウザ内で開く(inline)のは PDF と画像(PNG・JPEG・GIF・WebP)だけ。それ以外(HTML・SVG など)は保存させる(attachment)
//   - X-Content-Type-Options: nosniff で、中身から形式を推測させない(PDFと申告したHTMLをHTMLとして開かせない)
//   - PDF 以外には CSP の sandbox を付け、万一ブラウザで開かれてもスクリプトを動かさない
//     (PDF に付けると Chrome の PDF ビューアが表示できなくなるため、PDF には付けない)
// ファイルの応答(Content-Disposition 付き)を返す全ての API に効くよう、src/index.ts で全体に通す。

const INLINE_SAFE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);
const SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

// ファイルの応答(Content-Disposition 付き)のヘッダーを、その場で安全な形に書き換える
export function applySafeFileHeaders(headers: Headers): void {
  const disposition = headers.get("Content-Disposition");
  if (!disposition) return;

  const type = (headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  headers.set("X-Content-Type-Options", "nosniff");
  if (/^\s*inline/i.test(disposition) && !INLINE_SAFE_TYPES.has(type)) {
    headers.set("Content-Disposition", disposition.replace(/^\s*inline/i, "attachment"));
  }
  if (type !== "application/pdf") headers.set("Content-Security-Policy", SANDBOX_CSP);
}

// Honoでは c.res を差し替えると元のヘッダーで上書きされるため、応答のヘッダーをその場で書き換える
export async function safeFileResponse(c: Context, next: Next) {
  await next();
  applySafeFileHeaders(c.res.headers);
}
