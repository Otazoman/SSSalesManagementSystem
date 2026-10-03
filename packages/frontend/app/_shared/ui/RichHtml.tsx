interface RichHtmlProps {
  /** サーバーで無害化済みのHTML(お知らせ・画面説明のAPIが返す値。未加工の入力をそのまま渡さない) */
  html: string;
  className?: string;
}

/**
 * サーバーで無害化済みのHTML(リンク・書式・表など)を表示する共通部品。
 * 無害化はAPI側(backend/src/platform/html/sanitize-html.ts)で保存時・読み出し時に行うため、ここでは描画だけを担う。
 */
export function RichHtml({ html, className = "" }: RichHtmlProps) {
  return (
    <div
      className={`rich-html ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
