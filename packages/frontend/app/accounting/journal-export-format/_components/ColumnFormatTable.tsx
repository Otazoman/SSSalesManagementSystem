import { JournalExportColumn, JournalExportColumnKey } from "../_types";

interface ColumnFormatTableProps {
  columns: JournalExportColumn[];
  onMove: (index: number, direction: -1 | 1) => void;
  onToggle: (key: JournalExportColumnKey, enabled: boolean) => void;
  onRelabel: (key: JournalExportColumnKey, label: string) => void;
}

// 各列が実際にどんなデータを表すかの説明(見出し名自体は自由に変更できるため、キーの意味を
// 見失わないよう併記する)
const COLUMN_DESCRIPTIONS: Record<JournalExportColumnKey, string> = {
  batchId: "仕訳バッチの内部ID",
  entryDate: "計上日",
  description: "摘要",
  classification: "元仕訳/反対仕訳/訂正仕訳の区分",
  sourceType: "起票元の伝票種別",
  sourceRefId: "元伝票番号(発注番号・受注番号等)",
  eventType: "会計事象(前払/仕入計上/前受/売上計上)",
  side: "借方・貸方の別(1行=片側の形式のみ)",
  accountCode: "勘定科目コード(1行=片側の形式のみ)",
  accountName: "勘定科目名(1行=片側の形式のみ)",
  externalMappingCode: "勘定科目マスタの外部マッピングコード(1行=片側の形式のみ)",
  amount: "金額(1行=組の形式では組の金額)",
  taxCategoryCode: "消費税区分コード",
  taxRate: "税率",
  itemId: "品目ID",
  itemName: "品目名",
  sourceRefItemId: "元伝票の明細ID",
  projectId: "プロジェクトID",
  projectName: "プロジェクト名",
  department: "部署(承認申請または購買申請から解決、取得できない場合は空欄)",
  lineMemo: "明細メモ",
  batchMemo: "バッチメモ",
  postedById: "起票者",
  postedAt: "起票日時",
  originalBatchId: "訂正元の仕訳バッチID(反対仕訳・訂正仕訳のみ。元仕訳は空欄)",
  baseSourceRefId: "サフィックスを除いた元伝票番号(反対仕訳・訂正仕訳でも元の伝票番号で突合できる)",
  debitAccountCode: "借方の勘定科目コード(1行=片側の形式では借方の行だけ)",
  debitAccountName: "借方の勘定科目名",
  debitExternalMappingCode: "借方の勘定科目の外部マッピングコード",
  debitAmount: "借方の金額",
  debitTaxCategoryCode: "借方の消費税区分コード",
  debitTaxRate: "借方の税率",
  creditAccountCode: "貸方の勘定科目コード(1行=片側の形式では貸方の行だけ)",
  creditAccountName: "貸方の勘定科目名",
  creditExternalMappingCode: "貸方の勘定科目の外部マッピングコード",
  creditAmount: "貸方の金額",
  creditTaxCategoryCode: "貸方の消費税区分コード",
  creditTaxRate: "貸方の税率",
};

export function ColumnFormatTable({ columns, onMove, onToggle, onRelabel }: ColumnFormatTableProps) {
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            <th className="px-3 py-2 text-left w-20">順序</th>
            <th className="px-3 py-2 text-left w-16">出力</th>
            <th className="px-3 py-2 text-left">項目</th>
            <th className="px-3 py-2 text-left">見出し名(自由に変更可)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {columns.map((col, index) => (
            <tr key={col.key} className={col.enabled ? "" : "opacity-50"}>
              <td className="px-3 py-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => onMove(index, -1)}
                  disabled={index === 0}
                  className="px-1.5 py-0.5 rounded border border-slate-400 text-slate-700 font-bold disabled:opacity-30 mr-1"
                  aria-label="上へ移動"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMove(index, 1)}
                  disabled={index === columns.length - 1}
                  className="px-1.5 py-0.5 rounded border border-slate-400 text-slate-700 font-bold disabled:opacity-30"
                  aria-label="下へ移動"
                >
                  ↓
                </button>
              </td>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={col.enabled}
                  onChange={(e) => onToggle(col.key, e.target.checked)}
                />
              </td>
              <td className="px-3 py-2 text-slate-600">
                <div className="font-mono text-[11px] text-slate-600">{col.key}</div>
                <div>{COLUMN_DESCRIPTIONS[col.key]}</div>
              </td>
              <td className="px-3 py-2">
                <input
                  type="text"
                  value={col.label}
                  onChange={(e) => onRelabel(col.key, e.target.value)}
                  className="border border-slate-300 rounded p-1.5 text-xs w-full text-slate-900"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
