import { buildDocumentHref } from "../../../progress/_lib/document-href";

// REQ-021・REQ-022: 入庫・検収書から元の発注、出庫・納品書から元の受注を別タブで開くリンク(進捗確認と同じ開き方)。
// 番号が無い入出庫(単独の入庫・出庫)では何も出さない
export function SourceDocumentLink({
  kind,
  id,
  className = "",
}: {
  kind: "purchase_order" | "sales_order";
  id: string | null | undefined;
  className?: string;
}) {
  if (!id) return null;
  return (
    <a
      href={buildDocumentHref(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`font-mono text-indigo-700 hover:text-indigo-900 hover:underline ${className}`}
      title={kind === "purchase_order" ? "元の発注を別タブで開く" : "元の受注を別タブで開く"}
    >
      🔗 {id}
    </a>
  );
}
