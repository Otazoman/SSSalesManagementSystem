import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPanel } from "./SearchPanel";

function setup(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  const props = {
    searchId: "",
    setSearchId: vi.fn(),
    searchName: "",
    setSearchName: vi.fn(),
    searchNameMode: "partial" as const,
    setSearchNameMode: vi.fn(),
    searchBarcode: "",
    setSearchBarcode: vi.fn(),
    searchFilter: "",
    setSearchFilter: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<SearchPanel {...props} />);
  return props;
}

describe("SearchPanel(products)", () => {
  it("品目ID入力でsetSearchIdを呼ぶ", async () => {
    const props = setup();
    await userEvent.type(screen.getByPlaceholderText("品目IDで検索"), "I");
    expect(props.setSearchId).toHaveBeenCalledWith("I");
  });

  it("完全一致ラジオを選ぶとsetSearchNameModeを呼ぶ", async () => {
    const props = setup();
    await userEvent.click(screen.getByText("完全一致"));
    expect(props.setSearchNameMode).toHaveBeenCalledWith("exact");
  });

  it("取扱特性区分セレクトでsetSearchFilterを呼ぶ", async () => {
    const props = setup();
    await userEvent.selectOptions(screen.getByRole("combobox"), "purchased");
    expect(props.setSearchFilter).toHaveBeenCalledWith("purchased");
  });

  it("条件をクリアクリックでonClearを呼ぶ", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
