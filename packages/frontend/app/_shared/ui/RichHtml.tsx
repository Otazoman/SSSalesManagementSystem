import DOMPurify from "dompurify";

interface RichHtmlProps {
  /** サーバーで無害化済みのHTML(お知らせ・画面説明のAPIが返す値。未加工の入力をそのまま渡さない) */
  html: string;
  className?: string;
}

// BUG-083: 画面側でも描画の直前に無害化する(二重の防御)。許可するタグ・属性はサーバー
// (backend/src/platform/html/sanitize-html.ts)と同じ。style の値の検査はサーバー側で行う
const ALLOWED_TAGS = [
  "a", "b", "strong", "i", "em", "u", "s", "br", "hr", "p", "div", "span",
  "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "code", "pre",
  "table", "thead", "tbody", "tr", "th", "td", "img",
];
const ALLOWED_ATTR = [
  "href", "title", "target", "rel", "src", "alt", "width", "height", "colspan", "rowspan", "style",
];

export function sanitizeRichHtml(html: string): string {
  // DOM の無い環境(ビルド時の事前描画)では DOMPurify が使えないため、何も描画しない
  // (お知らせ・画面説明は表示時に API から取得するため、事前描画の時点では中身が無い)
  if (!DOMPurify.isSupported) return "";
  return DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // target は DOMPurify が既定で取り除くため明示して許可する(外部リンクの target="_blank" はサーバーが rel と一緒に付ける)
    ADD_ATTR: ["target"],
    ALLOW_DATA_ATTR: false,
    // リンク先の種類(http/https/mailto/tel・相対パス)の制限はサーバー側で行う。ここでは DOMPurify の既定の
    // 判定(javascript: などの危険なスキームを拒否する)を使う(独自の正規表現は URL 以外の属性値にも効くため使わない)
  });
}

/**
 * サーバーで無害化済みのHTML(リンク・書式・表など)を表示する共通部品。
 * 無害化はAPI側(backend/src/platform/html/sanitize-html.ts)で保存時・読み出し時に行い、
 * ここでも描画の直前に DOMPurify で無害化する(BUG-083)。
 */
export function RichHtml({ html, className = "" }: RichHtmlProps) {
  return (
    <div
      className={`rich-html ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(html) }}
    />
  );
}
