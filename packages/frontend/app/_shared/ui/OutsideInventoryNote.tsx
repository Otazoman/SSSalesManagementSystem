// REQ-011(1): 品目マスタに無い明細(直接入力)は、入荷・出荷の対象外(在庫に混ぜない)。入荷状況・出荷状況の表の下に、選べない行として灰色で出す
export interface OutsideInventoryLine {
  key: string;
  name: string;
  quantity: number;
  /** REQ-011(2): 一時保管で受け入れる・払い出す画面へのリンク(別のタブで開く) */
  href?: string;
  actionLabel?: string;
}

export function OutsideInventoryNote({ lines }: { lines: OutsideInventoryLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600 opacity-80">
      <p className="font-bold text-slate-700">品目マスタに無いため対象外(一時保管で管理できます)</p>
      <ul className="mt-1 space-y-0.5">
        {lines.map((line) => (
          <li key={line.key} className="flex items-center justify-between gap-2">
            <span>{line.name}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono">{line.quantity}</span>
              {line.href && (
                <a
                  href={line.href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-indigo-700 underline hover:text-indigo-900"
                >
                  {line.actionLabel ?? "一時保管で管理"}
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
