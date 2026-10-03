import { describe, it, expect } from "vitest";
import { pairJournalLines } from "./pair-journal-lines";

const line = (id: string, side: "DEBIT" | "CREDIT", amount: number) => ({ id, side, amount });
const summary = (lines: ReturnType<typeof line>[]) =>
  pairJournalLines(lines).map((p) => [p.debit?.id ?? null, p.credit?.id ?? null, p.amount]);

describe("pairJournalLines", () => {
  it("組ごとに借方行・貸方行の順で保存した仕訳は、そのまま組に戻る", () => {
    expect(
      summary([line("D1", "DEBIT", 1000), line("C1", "CREDIT", 1000), line("D2", "DEBIT", 100), line("C2", "CREDIT", 100)]),
    ).toEqual([
      ["D1", "C1", 1000],
      ["D2", "C2", 100],
    ]);
  });

  it("V-5より前の仕訳(売掛金1行に売上高・仮受消費税が複数行)は、上から順に金額を割り振る", () => {
    expect(
      summary([
        line("C1", "CREDIT", 1000),
        line("C2", "CREDIT", 2000),
        line("C3", "CREDIT", 300),
        line("D1", "DEBIT", 3300),
      ]),
    ).toEqual([
      ["D1", "C1", 1000],
      ["D1", "C2", 2000],
      ["D1", "C3", 300],
    ]);
  });

  it("両側が複数行でも、金額を割り振って組にする", () => {
    expect(summary([line("D1", "DEBIT", 400), line("D2", "DEBIT", 700), line("C1", "CREDIT", 1000), line("C2", "CREDIT", 100)])).toEqual([
      ["D1", "C1", 400],
      ["D2", "C1", 600],
      ["D2", "C2", 100],
    ]);
  });

  it("貸借が合わない残りは、片側だけの組にして出す", () => {
    expect(summary([line("D1", "DEBIT", 500), line("C1", "CREDIT", 300)])).toEqual([
      ["D1", "C1", 300],
      ["D1", null, 200],
    ]);
  });
});
