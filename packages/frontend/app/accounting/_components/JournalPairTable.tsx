import type { ReactNode } from "react";
import { TableScroll } from "../../_shared/ui/TableScroll";

// 仕訳の明細1行(借方か貸方の片側)。バックエンドが返す journal_lines の必要な項目だけ
export interface JournalPairLine {
  id?: string;
  accountCode: string;
  accountName: string;
  taxCategoryCode?: string | null;
  itemName?: string | null;
}

// 「借方〇〇/貸方〇〇」の1組(借方・貸方は同じ金額)。貸借が合わない古い仕訳では片側が null になり得る
export interface JournalPair<L extends JournalPairLine = JournalPairLine> {
  amount: number;
  debit: L | null;
  credit: L | null;
}

const yen = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;

/** 勘定科目コード→科目名(勘定科目マスタ)。仕訳に科目名が無い場合の表示に使う */
export type AccountNames = Record<string, string>;

/**
 * 表示する科目名。仕訳には転記時点の科目名を保存しているが、V-5より前の売上・仕入の仕訳は
 * 科目名の欄にコードが入っているため、その場合は勘定科目マスタの名前を使う
 */
export function accountDisplayName(line: Pick<JournalPairLine, "accountCode" | "accountName">, names?: AccountNames) {
  if (line.accountName && line.accountName !== line.accountCode) return line.accountName;
  return names?.[line.accountCode] ?? line.accountName;
}

/** 科目名とコード(例: 売掛金 1301) */
export function AccountLabel({
  line,
  names,
  className = "font-bold text-slate-800",
}: {
  line: Pick<JournalPairLine, "accountCode" | "accountName">;
  names?: AccountNames;
  className?: string;
}) {
  const name = accountDisplayName(line, names);
  return (
    <>
      <span className={className}>{name}</span>
      {name !== line.accountCode && (
        <span className="ml-1 font-mono text-[10px] font-normal text-slate-600">{line.accountCode}</span>
      )}
    </>
  );
}

// 品目名・税区分(組のどちらかの側にだけ付いていることが多い)
export function pairNote(pair: JournalPair): string {
  const itemName = pair.debit?.itemName || pair.credit?.itemName;
  const tax = pair.debit?.taxCategoryCode || pair.credit?.taxCategoryCode;
  return [itemName, tax ? `税区分 ${tax}` : null].filter(Boolean).join(" / ");
}

interface JournalPairTableProps<L extends JournalPairLine> {
  pairs: JournalPair<L>[];
  /** 勘定科目のセルを差し替える(訂正フォームで科目を選ばせる場合など)。省略時は科目名+コード */
  renderAccount?: (line: L, side: "DEBIT" | "CREDIT") => ReactNode;
  /** 勘定科目マスタの科目名(仕訳に科目名が無い古い仕訳の表示用) */
  accountNames?: AccountNames;
}

/**
 * 仕訳を「借方〇〇/貸方〇〇」の組で1行ずつ並べる表。最下行に借方合計・貸方合計を出す。
 */
export function JournalPairTable<L extends JournalPairLine>({
  pairs,
  renderAccount,
  accountNames,
}: JournalPairTableProps<L>) {
  const debitTotal = pairs.reduce((sum, p) => sum + (p.debit ? p.amount : 0), 0);
  const creditTotal = pairs.reduce((sum, p) => sum + (p.credit ? p.amount : 0), 0);

  const sideCells = (pair: JournalPair<L>, side: "DEBIT" | "CREDIT") => {
    const line = side === "DEBIT" ? pair.debit : pair.credit;
    const border = side === "CREDIT" ? "border-l-2 border-slate-300" : "";
    if (!line) {
      return (
        <>
          <td className={`px-3 py-2 text-slate-500 ${border}`}>-</td>
          <td className="px-3 py-2" />
        </>
      );
    }
    return (
      <>
        <td className={`px-3 py-2 align-top ${border}`}>
          {renderAccount ? renderAccount(line, side) : <AccountLabel line={line} names={accountNames} />}
        </td>
        <td className="px-3 py-2 align-top text-right font-mono font-bold text-slate-800 whitespace-nowrap">
          {yen(pair.amount)}
        </td>
      </>
    );
  };

  return (
    <TableScroll minWidth={640} bare>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left px-3 py-1.5 font-black bg-indigo-50 text-indigo-800">借方科目</th>
            <th className="text-right px-3 py-1.5 font-black bg-indigo-50 text-indigo-800">借方金額</th>
            <th className="text-left px-3 py-1.5 font-black bg-orange-50 text-orange-800 border-l-2 border-slate-300">
              貸方科目
            </th>
            <th className="text-right px-3 py-1.5 font-black bg-orange-50 text-orange-800">貸方金額</th>
            <th className="text-left px-3 py-1.5 font-bold text-slate-800 border-l border-slate-200">品目・税区分</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((pair, i) => (
            <tr key={i} className="border-b border-slate-100">
              {sideCells(pair, "DEBIT")}
              {sideCells(pair, "CREDIT")}
              <td className="px-3 py-2 align-top text-slate-700 border-l border-slate-200">
                {pairNote(pair) || <span className="text-slate-500">-</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 border-t-2 border-slate-300">
            <td className="px-3 py-1.5 font-bold text-slate-800">借方合計</td>
            <td className="px-3 py-1.5 text-right font-mono font-black text-slate-900">{yen(debitTotal)}</td>
            <td className="px-3 py-1.5 font-bold text-slate-800 border-l-2 border-slate-300">貸方合計</td>
            <td className="px-3 py-1.5 text-right font-mono font-black text-slate-900">{yen(creditTotal)}</td>
            <td className="border-l border-slate-200" />
          </tr>
        </tfoot>
      </table>
    </TableScroll>
  );
}
