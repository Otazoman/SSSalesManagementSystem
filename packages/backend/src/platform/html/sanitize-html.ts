/**
 * ユーザーが入力したHTML(お知らせ・画面説明)を、表示しても安全な形へ無害化する。
 *
 * BUG-083: 無害化は実績のあるライブラリ(sanitize-html。DOM を使わないため Workers でも動く)に任せる。
 * 許可する内容は従来の独自実装と同じ:
 *   - 許可したタグ・属性だけを残す。script/style/iframe 等の危険なタグは中身ごと捨て、それ以外の未許可タグはタグだけ捨てて文字は残す
 *   - リンク(href)は http/https/mailto/tel・"/" または "#" で始まる相対パスのみ。画像(src)は http/https・相対パスのみ。
 *     外部リンクには target="_blank" rel="noopener noreferrer" を付ける
 *   - style 属性は、見た目に関する少数のプロパティ・安全な値だけ残す(url()・expression 等は捨てる)
 *   - 入れ子の深さを制限する
 * 画面側でも描画の直前に DOMPurify で無害化する(frontend/app/_shared/ui/RichHtml.tsx。二重の防御)。
 */
import sanitize from "sanitize-html";

/** 表示を許可するタグ */
const ALLOWED_TAGS = [
  "a", "b", "strong", "i", "em", "u", "s", "br", "hr", "p", "div", "span",
  "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "code", "pre",
  "table", "thead", "tbody", "tr", "th", "td", "img",
];
/** 中身ごと捨てるタグ(中身を文字として残すと、CSS/JSの断片が画面に出るため) */
const DROP_WITH_CONTENT = [
  "script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math",
  "textarea", "title", "head", "link", "meta", "form", "select", "option", "button", "xmp", "noembed", "noframes",
];

const MAX_DEPTH = 30;
const MAX_STYLE_LENGTH = 300;
const MAX_TEXT_ATTR_LENGTH = 300;
// 数字・英字・#・空白・.,%()+- のみ。url()・expression・javascript・@import・var() は不可
const SAFE_STYLE_VALUE = [/^(?!.*(?:url\s*\(|expression|javascript|import|var\s*\())[#a-z0-9\s.,%()+-]+$/i];
const ALLOWED_STYLE_PROPS = [
  "color", "background-color", "font-size", "font-weight", "font-style", "text-align",
  "text-decoration", "line-height", "margin", "margin-top", "margin-bottom", "padding",
];

// リンク・画像の URL。スキームの判定(javascript: 等の偽装の検出)は sanitize-html が行い、
// ここでは「スキームの無い相対パスは / か # で始まるものだけ」に絞る(従来どおり)
const isAllowedUrl = (url: string, kinds: { mailto: boolean }) => {
  const compact = url.trim();
  if (/^https?:/i.test(compact) || compact.startsWith("//")) return true;
  if (/^(mailto|tel):/i.test(compact)) return kinds.mailto;
  return compact.startsWith("/") || compact.startsWith("#");
};
const isExternalUrl = (url: string) => /^(https?:)?\/\//i.test(url.trim());

// 従来どおりの属性の値の制限(数字のみ・長さの上限)。満たさない属性は捨てる
function limitAttributes(attribs: Record<string, string>, tagName: string) {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(attribs)) {
    if (name === "style") {
      if (value.length <= MAX_STYLE_LENGTH) out.style = value;
    } else if (name === "title" || name === "alt") {
      out[name] = value.slice(0, MAX_TEXT_ATTR_LENGTH);
    } else if (name === "width" || name === "height") {
      if (/^\d{1,4}$/.test(value.trim())) out[name] = value.trim();
    } else if (name === "colspan" || name === "rowspan") {
      if (/^\d{1,2}$/.test(value.trim())) out[name] = value.trim();
    } else if (name === "href" && tagName === "a") {
      if (isAllowedUrl(value, { mailto: true })) out.href = value;
    } else if (name === "src" && tagName === "img") {
      if (isAllowedUrl(value, { mailto: false })) out.src = value;
    } else if (name !== "target" && name !== "rel") {
      out[name] = value;
    }
  }
  return out;
}

const OPTIONS: sanitize.IOptions = {
  allowedTags: ALLOWED_TAGS,
  // 未許可のタグはタグだけ捨てて、中の文字は残す。DROP_WITH_CONTENT は中身ごと捨てる
  disallowedTagsMode: "discard",
  nonTextTags: DROP_WITH_CONTENT,
  allowedAttributes: {
    "*": ["style"],
    a: ["href", "title", "target", "rel"],
    span: ["title"],
    img: ["src", "alt", "title", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: true,
  allowedStyles: {
    "*": Object.fromEntries(ALLOWED_STYLE_PROPS.map((prop) => [prop, SAFE_STYLE_VALUE])),
  },
  nestingLimit: MAX_DEPTH,
  // 外部リンクは新しいタブで開き、開いた先から元の画面を操作されないようにする(利用者が指定した target/rel は使わない)
  transformTags: {
    "*": (tagName, attribs) => {
      const limited = limitAttributes(attribs, tagName);
      if (tagName === "a" && limited.href && isExternalUrl(limited.href)) {
        limited.target = "_blank";
        limited.rel = "noopener noreferrer";
      }
      return { tagName, attribs: limited };
    },
  },
};

export function sanitizeHtml(input: string): string {
  return sanitize(input ?? "", OPTIONS);
}

const escapeText = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 従来の平文(改行区切り)の本文を、HTMLへ変換する(移行用): 文字を無害化し、改行を <br> にする */
export function plainTextToHtml(text: string): string {
  return escapeText((text ?? "").replace(/&/g, "&amp;"))
    .replace(/\r\n|\r|\n/g, "<br>");
}
