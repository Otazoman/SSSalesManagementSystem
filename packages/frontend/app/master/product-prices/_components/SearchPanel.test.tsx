import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPanel } from "./SearchPanel";
import { MasterPartner } from "../_types";

const partners: MasterPartner[] = [{ id: "CUST-1", name: "得意先A" }];

function setup(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  const props = {
    searchItemId: "",
    setSearchItemId: vi.fn(),
    searchPriceType: "",
    setSearchPriceType: vi.fn(),
    searchPartnerId: "",
    setSearchPartnerId: vi.fn(),
    searchStatus: "",
    setSearchStatus: vi.fn(),
    partners,
    onClear: vi.fn(),
    ...overrides,
  };
  render(<SearchPanel {...props} />);
  return props;
}

describe("SearchPanel(product-prices)", () => {
  it("取引先セレクトに顧客一覧を表示する", () => {
    setup();
    expect(screen.getByText("得意先A")).toBeInTheDocument();
  });

  it("品目コード入力でsetSearchItemIdを呼ぶ", async () => {
    const props = setup();
    await userEvent.type(screen.getByPlaceholderText("品目コードで検索..."), "I");
    expect(props.setSearchItemId).toHaveBeenCalledWith("I");
  });

  it("条件をクリアクリックでonClearを呼ぶ", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
