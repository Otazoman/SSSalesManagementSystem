import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutsideInventoryNote } from "./OutsideInventoryNote";

// REQ-011(1): 品目マスタに無い明細は、入荷・出荷の対象外として灰色で出す
describe("OutsideInventoryNote", () => {
  it("直接入力の明細を、対象外の案内と一緒に出す", () => {
    render(<OutsideInventoryNote lines={[{ key: "L1", name: "特注の部品", quantity: 2 }]} />);
    expect(screen.getByText("品目マスタに無いため対象外(一時保管で管理できます)")).toBeInTheDocument();
    expect(screen.getByText("特注の部品")).toBeInTheDocument();
  });
  it("対象外の明細が無ければ何も出さない", () => {
    const { container } = render(<OutsideInventoryNote lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("OutsideInventoryNote: REQ-011(2) 一時保管へのリンク", () => {
  it("リンクがある明細は、一時保管の画面を別のタブで開くリンクを出す", () => {
    render(
      <OutsideInventoryNote
        lines={[{ key: "L1", name: "特注の部品", quantity: 2, href: "/inventory/audit?tab=holdings", actionLabel: "一時保管で受入" }]}
      />,
    );
    const link = screen.getByRole("link", { name: "一時保管で受入" });
    expect(link).toHaveAttribute("href", "/inventory/audit?tab=holdings");
    expect(link).toHaveAttribute("target", "_blank");
  });
});
