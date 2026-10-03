import type { ReactNode } from "react";
import { useCurrentScreenDescription } from "../../context/screen-descriptions";
import { RichHtml } from "./RichHtml";

interface PageHeaderProps {
  /** 例: "📄 見積発行申請・管理"(バッジなどを添える場合は要素も可) */
  title: ReactNode;
  description?: ReactNode;
  /** 右側の操作ボタン群(<Button> など)。狭い画面では下に折り返す */
  actions?: ReactNode;
}

/**
 * 画面上部の見出し(タイトル・説明・操作ボタン)。スマホでは縦に積み、ボタンは折り返す。
 * 管理者がこの画面に説明(HTML)を設定している場合は、コードの既定の説明の代わりにそれを表示する。
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  const customDescription = useCurrentScreenDescription();
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-black text-slate-900 sm:text-2xl">
          {title}
        </h1>
        {customDescription ? (
          <RichHtml
            html={customDescription}
            className="mt-1 text-xs text-slate-600"
          />
        ) : (
          description && (
            <p className="mt-1 text-xs text-slate-600">{description}</p>
          )
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
