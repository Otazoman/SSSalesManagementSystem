// 仕訳の明細(借方の行・貸方の行)を「借方〇〇/貸方〇〇」の組に並べ直す(V-5)。
// V-5以降の仕訳は、組ごとに借方行・貸方行を同じ金額・同じ順で保存しているため、そのまま組に戻る。
// それより前の仕訳(売掛金1行に売上高・仮受消費税が複数行、など)は、上から順に金額を割り振って組にする
// (例: 売掛金3,300 / 売上高1,000・売上高2,000・仮受消費税300 → 3組)。

export interface JournalPair<L> {
  amount: number;
  debit: L | null;
  credit: L | null;
}

export function pairJournalLines<L extends { side: "DEBIT" | "CREDIT"; amount: number }>(
  lines: L[],
): JournalPair<L>[] {
  const debits = lines.filter((l) => l.side === "DEBIT").map((line) => ({ line, left: line.amount }));
  const credits = lines.filter((l) => l.side === "CREDIT").map((line) => ({ line, left: line.amount }));
  const pairs: JournalPair<L>[] = [];
  let d = 0;
  let c = 0;
  while (d < debits.length && c < credits.length) {
    const amount = Math.min(debits[d].left, credits[c].left);
    if (amount > 0) pairs.push({ amount, debit: debits[d].line, credit: credits[c].line });
    debits[d].left -= amount;
    credits[c].left -= amount;
    if (debits[d].left <= 0) d++;
    if (credits[c].left <= 0) c++;
  }
  // 貸借が合わない仕訳(通常は起きない)は、残りを片側だけの組にして隠さず出す
  for (; d < debits.length; d++) {
    if (debits[d].left > 0) pairs.push({ amount: debits[d].left, debit: debits[d].line, credit: null });
  }
  for (; c < credits.length; c++) {
    if (credits[c].left > 0) pairs.push({ amount: credits[c].left, debit: null, credit: credits[c].line });
  }
  return pairs;
}
