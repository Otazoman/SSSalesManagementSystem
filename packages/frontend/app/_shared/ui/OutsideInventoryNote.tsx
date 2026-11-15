// REQ-011(1): 品目マスタに無い明細(直接入力)は、入荷・出荷の対象外(在庫に混ぜない)。入荷状況・出荷状況の表の下に、選べない行として灰色で出す
export interface OutsideInventoryLine {
  key: string;
  name: string;
  quantity: number;
}

export function OutsideInventoryNote({ lines }: { lines: OutsideInventoryLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600 opacity-80">
      <p className="font-bold text-slate-700">品目マスタに無いため対象外(一時保管で管理できます)</p>
      <ul className="mt-1 space-y-0.5">
        {lines.map((line) => (
          <li key={line.key} className="flex justify-between">
            <span>{line.name}</span>
            <span className="font-mono">{line.quantity}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
