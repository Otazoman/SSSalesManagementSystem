import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPanelShell } from "./SearchPanelShell";

describe("SearchPanelShell", () => {
  it("デフォルトタイトルとchildrenを表示する", () => {
    render(
      <SearchPanelShell>
        <input aria-label="keyword" />
      </SearchPanelShell>,
    );
    expect(screen.getByText("🔍 条件指定検索")).toBeInTheDocument();
    expect(screen.getByLabelText("keyword")).toBeInTheDocument();
  });

  it("onClearSearch未指定時は条件をクリアボタンを表示しない", () => {
    render(
      <SearchPanelShell>
        <input />
      </SearchPanelShell>,
    );
    expect(screen.queryByRole("button", { name: "条件をクリア" })).not.toBeInTheDocument();
  });

  it("onClearSearch指定時はクリックでコールバックを呼ぶ", async () => {
    const onClearSearch = vi.fn();
    render(
      <SearchPanelShell onClearSearch={onClearSearch}>
        <input />
      </SearchPanelShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });
});
