/**
 * ユーザーが入力したHTML(お知らせ・画面説明)を、表示しても安全な形へ無害化する。
 *
 * 方式: 「許可リスト方式で HTML を作り直す」。入力を字句解析(タグ・属性・テキストに分解)し、
 *   - 許可したタグ・属性だけを、こちらで組み立て直して出力する(入力の文字列をそのまま通さない)
 *   - script/style/iframe 等の危険なタグは中身ごと捨てる。それ以外の未許可タグはタグだけ捨てて文字は残す
 *   - リンク(href/src)は http/https/mailto/tel/相対パスのみ。javascript: 等は、HTMLエンティティや空白・制御文字で
 *     偽装されていても検出して捨てる。外部リンクには target="_blank" rel="noopener noreferrer" を付ける
 *   - style 属性は、見た目に関する少数のプロパティ・安全な値だけ残す(url()・expression 等は捨てる)
 *   - 閉じ忘れのタグは補い、対応しない閉じタグは捨てる(ネストを壊して他の画面を崩さない)
 * DOM が無い Workers 環境でも動くよう、外部ライブラリに依存しない純粋な文字列処理にしている。
 */

/** 表示を許可するタグ */
const ALLOWED_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "br", "hr", "p", "div", "span",
  "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "code", "pre",
  "table", "thead", "tbody", "tr", "th", "td", "img",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
/** 中身ごと捨てるタグ(中身を文字として残すと、CSS/JSの断片が画面に出るため) */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math",
  "textarea", "title", "head", "link", "meta", "form", "select", "option", "button", "xmp", "noembed", "noframes",
]);

const MAX_DEPTH = 30;
const MAX_STYLE_LENGTH = 300;
const ALLOWED_STYLE_PROPS = new Set([
  "color", "background-color", "font-size", "font-weight", "font-style", "text-align",
  "text-decoration", "line-height", "margin", "margin-top", "margin-bottom", "padding",
]);

const NAMED_ENTITIES: Record<string, string> = {
  colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", sol: "/", quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " ",
};

/** HTMLエンティティを戻す(URL・style の検査を、エンティティによる偽装から守るための正規化用) */
function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? m;
  });
}

/** URL判定の前に取り除く、空白・制御文字・不可視文字("java
script:" 等の偽装対策) */
const INVISIBLE_CHARS = new RegExp(
  "[" + ["\u0000-\u0020", "\u007f-\u009f", "\u00ad", "\u200b-\u200f", "\u2028", "\u2029", "\ufeff"].join("") + "]",
  "g",
);

const escapeText = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** URLの検査。許可する場合は(エンティティを戻した)値を、許可しない場合は null を返す */
function safeUrl(raw: string, kinds: { http: boolean; mailto: boolean; relative: boolean }): string | null {
  const decoded = decodeEntities(raw).trim();
  // 空白・制御文字を除いた形でスキームを判定する("java\nscript:" 等の偽装対策)
  const compact = decoded.replace(INVISIBLE_CHARS, "").toLowerCase();
  if (compact === "") return null;
  if (/^https?:/.test(compact)) return kinds.http ? decoded : null;
  if (/^(mailto|tel):/.test(compact)) return kinds.mailto ? decoded : null;
  if (/^[a-z][a-z0-9+.-]*:/.test(compact)) return null; // javascript:, data:, vbscript: など、その他のスキームは全て不可
  if (kinds.relative && (compact.startsWith("/") || compact.startsWith("#"))) return decoded;
  return null;
}

function sanitizeStyle(raw: string): string {
  const decoded = decodeEntities(raw);
  if (decoded.length > MAX_STYLE_LENGTH) return "";
  const out: string[] = [];
  for (const decl of decoded.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    // 数字・英字・#・空白・.,%()+- のみ。url()・expression・バックスラッシュ・@import 等は不可
    if (!/^[#a-z0-9\s.,%()+-]+$/i.test(value)) continue;
    if (/url\s*\(|expression|javascript|import|var\s*\(/i.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

interface RawAttr {
  name: string;
  value: string;
}

/** 開始タグの属性部分を字句解析する(引用符の中の > を、タグの終わりと取り違えない) */
function parseAttributes(src: string): RawAttr[] {
  const attrs: RawAttr[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    while (i < n && /[\s/]/.test(src[i])) i++;
    if (i >= n) break;
    let name = "";
    while (i < n && !/[\s=/>]/.test(src[i])) name += src[i++];
    while (i < n && /\s/.test(src[i])) i++;
    let value = "";
    if (src[i] === "=") {
      i++;
      while (i < n && /\s/.test(src[i])) i++;
      const q = src[i];
      if (q === '"' || q === "'") {
        i++;
        while (i < n && src[i] !== q) value += src[i++];
        i++;
      } else {
        while (i < n && !/[\s>]/.test(src[i])) value += src[i++];
      }
    }
    if (name) attrs.push({ name: name.toLowerCase(), value });
  }
  return attrs;
}

/** 開始タグ内の終端 '>' を探す(引用符の中は飛ばす)。見つからなければ -1 */
function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

function buildAttributes(tag: string, attrs: RawAttr[]): string {
  const out: string[] = [];
  let external = false;
  for (const { name, value } of attrs) {
    if (name.startsWith("on")) continue; // onclick 等のイベントは全て不可
    if (name === "style") {
      const s = sanitizeStyle(value);
      if (s) out.push(`style="${escapeAttr(s)}"`);
    } else if (name === "title" && (tag === "a" || tag === "span" || tag === "img")) {
      out.push(`title="${escapeAttr(decodeEntities(value)).slice(0, 300)}"`);
    } else if (tag === "a" && name === "href") {
      const url = safeUrl(value, { http: true, mailto: true, relative: true });
      if (url !== null) {
        out.push(`href="${escapeAttr(url)}"`);
        if (/^(https?:)?\/\//i.test(url.replace(/[\u0000- ]/g, ""))) external = true;
      }
    } else if (tag === "img" && name === "src") {
      const url = safeUrl(value, { http: true, mailto: false, relative: true });
      if (url !== null) out.push(`src="${escapeAttr(url)}"`);
    } else if (tag === "img" && name === "alt") {
      out.push(`alt="${escapeAttr(decodeEntities(value)).slice(0, 300)}"`);
    } else if (tag === "img" && (name === "width" || name === "height") && /^\d{1,4}$/.test(value.trim())) {
      out.push(`${name}="${value.trim()}"`);
    } else if ((tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan") && /^\d{1,2}$/.test(value.trim())) {
      out.push(`${name}="${value.trim()}"`);
    }
  }
  if (tag === "a" && external) out.push('target="_blank"', 'rel="noopener noreferrer"');
  return out.length ? " " + out.join(" ") : "";
}

export function sanitizeHtml(input: string): string {
  const html = input ?? "";
  let out = "";
  const stack: string[] = [];
  let i = 0;
  const n = html.length;

  const closeTo = (index: number) => {
    while (stack.length > index) out += `</${stack.pop()}>`;
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out += escapeText(html.slice(i));
      break;
    }
    out += escapeText(html.slice(i, lt));
    i = lt;

    // コメント
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    // <!DOCTYPE> <![CDATA[ <? など
    if (/^<[!?]/.test(html.slice(i, i + 2))) {
      const end = html.indexOf(">", i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    // 閉じタグ
    const endTag = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(i, i + 40));
    if (endTag) {
      const gt = html.indexOf(">", i);
      const name = endTag[1].toLowerCase();
      i = gt < 0 ? n : gt + 1;
      if (ALLOWED_TAGS.has(name) && !VOID_TAGS.has(name)) {
        const at = stack.lastIndexOf(name);
        if (at >= 0) closeTo(at);
      }
      continue;
    }
    // 開始タグ
    const startTag = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(i, i + 40));
    if (startTag) {
      const name = startTag[1].toLowerCase();
      const attrStart = i + startTag[0].length;
      const gt = findTagEnd(html, attrStart);
      if (gt < 0) {
        // 閉じていないタグ: 以降はタグとして扱わず文字にする
        out += escapeText(html.slice(i));
        break;
      }
      const attrSrc = html.slice(attrStart, gt);
      i = gt + 1;
      if (DROP_WITH_CONTENT.has(name)) {
        const closeRe = new RegExp(`</${name}\\s*>`, "i");
        const m = closeRe.exec(html.slice(i));
        i = m ? i + m.index + m[0].length : n;
        continue;
      }
      if (!ALLOWED_TAGS.has(name)) continue; // タグだけ捨てて、中の文字は残す
      if (VOID_TAGS.has(name)) {
        out += `<${name}${buildAttributes(name, parseAttributes(attrSrc))}>`;
        continue;
      }
      if (stack.length >= MAX_DEPTH) continue;
      out += `<${name}${buildAttributes(name, parseAttributes(attrSrc))}>`;
      stack.push(name);
      continue;
    }
    // 「<」の後がタグ名でない(例: 1 < 2): 文字として残す
    out += "&lt;";
    i += 1;
  }
  closeTo(0);
  return out;
}

/** 従来の平文(改行区切り)の本文を、HTMLへ変換する(移行用): 文字を無害化し、改行を <br> にする */
export function plainTextToHtml(text: string): string {
  return escapeText((text ?? "").replace(/&/g, "&amp;"))
    .replace(/\r\n|\r|\n/g, "<br>");
}
