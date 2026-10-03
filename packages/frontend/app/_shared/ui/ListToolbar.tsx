import type { ReactNode } from "react";

interface ListToolbarProps {
  /** 左側: 状態の絞り込みタブなど */
  filters?: ReactNode;
  /** 右側: 該当件数・CSV・新規作成などの操作。狭い画面では折り返す */
  actions?: ReactNode;
}

/**
 * 一覧の上の操作バー。1行に収まれば左右に振り分け、収まらなければ操作を次の行へ送る
 * (タブ・ボタンを押し潰さない)。操作ボタンの並びも、収まらなければ折り返す
 */
export function ListToolbar({ filters, actions }: ListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {filters && <div className="max-w-full">{filters}</div>}
      {actions && (
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
