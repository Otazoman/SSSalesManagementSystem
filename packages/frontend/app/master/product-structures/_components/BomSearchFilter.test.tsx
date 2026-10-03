import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BomSearchFilter } from "./BomSearchFilter";

function setup(overrides: Partial<Parameters<typeof BomSearchFilter>[0]> = {}) {
  const props = {
    searchParentId: "",
    setSearchParentId: vi.fn(),
    searchChildId: "",
    setSearchChildId: vi.fn(),
    onClearSearch: vi.fn(),
    ...overrides,
  };
  render(<BomSearchFilter {...props} />);
  return props;
}

describe("BomSearchFilter", () => {
  it("親IDを入力するとsetSearchParentIdを呼ぶ", async () => {
    const props = setup();
    await userEvent.type(screen.getByPlaceholderText("親IDを入力"), "T");
    expect(props.setSearchParentId).toHaveBeenCalledWith("T");
  });

  it("子IDを入力するとsetSearchChildIdを呼ぶ", async () => {
    const props = setup();
    await userEvent.type(screen.getByPlaceholderText("子IDを入力"), "C");
    expect(props.setSearchChildId).toHaveBeenCalledWith("C");
  });

  it("条件をクリアクリックでonClearSearchを呼ぶ", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(props.onClearSearch).toHaveBeenCalledTimes(1);
  });
});
