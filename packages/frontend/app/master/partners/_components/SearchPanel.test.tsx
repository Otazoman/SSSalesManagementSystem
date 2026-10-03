import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchPanel from "./SearchPanel";

function setup(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  const props = {
    searchId: "",
    setSearchId: vi.fn(),
    searchName: "",
    setSearchName: vi.fn(),
    searchNameMode: "partial" as const,
    setSearchNameMode: vi.fn(),
    searchType: "",
    setSearchType: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<SearchPanel {...props} />);
  return props;
}

describe("SearchPanel(partners)", () => {
  it("コード入力でsetSearchIdを呼ぶ", async () => {
    const props = setup();
    await userEvent.type(screen.getByPlaceholderText("コードを入力"), "C");
    expect(props.setSearchId).toHaveBeenCalledWith("C");
  });

  it("完全一致ラジオを選ぶとsetSearchNameModeを呼ぶ", async () => {
    const props = setup();
    await userEvent.click(screen.getByText("完全"));
    expect(props.setSearchNameMode).toHaveBeenCalledWith("exact");
  });

  it("区分セレクトでsetSearchTypeを呼ぶ", async () => {
    const props = setup();
    await userEvent.selectOptions(screen.getByRole("combobox"), "SUPPLIER");
    expect(props.setSearchType).toHaveBeenCalledWith("SUPPLIER");
  });

  it("条件をクリアクリックでonClearを呼ぶ", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
