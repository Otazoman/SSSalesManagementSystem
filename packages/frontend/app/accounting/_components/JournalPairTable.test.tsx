import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { accountDisplayName, JournalPairTable, pairNote, type JournalPair } from "./JournalPairTable";

const PAIRS: JournalPair[] = [
  {
    amount: 1000,
    debit: { id: "L1", accountCode: "1131", accountName: "売掛金", itemName: "品目A" },
    credit: { id: "L2", accountCode: "4101", accountName: "売上高", itemName: "品目A", taxCategoryCode: "TAX_10" },
  },
  {
    amount: 100,
    debit: { id: "L3", accountCode: "1131", accountName: "売掛金" },
    credit: { id: "L4", accountCode: "2301", accountName: "仮受消費税" },
  },
];

describe("JournalPairTable", () => {
  it("1組を1行にし、借方科目・借方金額・貸方科目・貸方金額・品目を並べる", () => {
    render(<JournalPairTable pairs={PAIRS} />);
    const rows = screen.getAllByRole("rowgroup")[1].querySelectorAll("tr");
    expect(rows).toHaveLength(2);
    const cells = within(rows[0] as HTMLElement).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual([
      "売掛金1131",
      "¥1,000",
      "売上高4101",
      "¥1,000",
      "品目A / 税区分 TAX_10",
    ]);
  });

  it("借方合計・貸方合計を出す", () => {
    render(<JournalPairTable pairs={PAIRS} />);
    const totals = within(screen.getAllByRole("rowgroup")[2]).getAllByRole("cell");
    expect(totals.slice(0, 4).map((c) => c.textContent)).toEqual(["借方合計", "¥1,100", "貸方合計", "¥1,100"]);
  });

  it("片側が無い組は「-」を出し、その側の合計に含めない", () => {
    render(<JournalPairTable pairs={[{ amount: 50, debit: PAIRS[0].debit, credit: null }]} />);
    const cells = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("-");
    const totals = within(screen.getAllByRole("rowgroup")[2]).getAllByRole("cell");
    expect(totals[3]).toHaveTextContent("¥0");
  });

  it("renderAccountで科目のセルを差し替えられる(側も渡す)", () => {
    render(<JournalPairTable pairs={PAIRS} renderAccount={(line, side) => <span>{`${side}:${line.id}`}</span>} />);
    expect(screen.getByText("DEBIT:L1")).toBeInTheDocument();
    expect(screen.getByText("CREDIT:L4")).toBeInTheDocument();
  });

  it("pairNote: 品目名と税区分を、どちらの側にあってもまとめる", () => {
    expect(pairNote(PAIRS[0])).toBe("品目A / 税区分 TAX_10");
    expect(pairNote(PAIRS[1])).toBe("");
  });

  it("科目名の欄にコードが入っている古い仕訳は、勘定科目マスタの名前とコードを表示する", () => {
    render(
      <JournalPairTable
        pairs={[{ amount: 10, debit: { accountCode: "1301", accountName: "1301" }, credit: { accountCode: "9999", accountName: "9999" } }]}
        accountNames={{ "1301": "売掛金" }}
      />,
    );
    const cells = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("cell");
    expect(cells[0].textContent).toBe("売掛金1301");
    // マスタに無い科目はコードだけ(同じコードを2回出さない)
    expect(cells[2].textContent).toBe("9999");
  });

  it("accountDisplayName: 保存された科目名を優先し、コードしか無い場合はマスタの名前を使う", () => {
    expect(accountDisplayName({ accountCode: "1301", accountName: "売掛金(旧)" }, { "1301": "売掛金" })).toBe("売掛金(旧)");
    expect(accountDisplayName({ accountCode: "1301", accountName: "1301" }, { "1301": "売掛金" })).toBe("売掛金");
    expect(accountDisplayName({ accountCode: "1301", accountName: "1301" })).toBe("1301");
  });
});
