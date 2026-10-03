import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterForm } from "./FilterForm";

function baseProps() {
  return {
    startDate: "",
    setStartDate: vi.fn(),
    endDate: "",
    setEndDate: vi.fn(),
    userId: "",
    setUserId: vi.fn(),
    action: "",
    setAction: vi.fn(),
    resourceKey: "",
    setResourceKey: vi.fn(),
    resourceOptions: [
      { key: "", label: "すべてのアプリケーション画面" },
      { key: "units", label: "単位マスタ" },
    ],
    loading: false,
    onSubmit: vi.fn((e: React.SyntheticEvent) => e.preventDefault()),
    onClear: vi.fn(),
  };
}

describe("FilterForm", () => {
  it("選択肢を表示する", () => {
    render(<FilterForm {...baseProps()} />);
    expect(screen.getByText("単位マスタ")).toBeInTheDocument();
  });

  it("ユーザーID入力でsetUserIdを呼ぶ", async () => {
    const props = baseProps();
    render(<FilterForm {...props} />);
    await userEvent.type(screen.getByPlaceholderText("例: EMP2026"), "E");
    expect(props.setUserId).toHaveBeenCalledWith("E");
  });

  it("loading:trueの場合は検索ボタンが無効になり文言が変わる", () => {
    render(<FilterForm {...baseProps()} loading />);
    expect(screen.getByRole("button", { name: "処理中..." })).toBeDisabled();
  });

  it("条件をクリアクリックでonClearを呼ぶ", async () => {
    const props = baseProps();
    render(<FilterForm {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it("フォーム送信でonSubmitを呼ぶ", async () => {
    const props = baseProps();
    render(<FilterForm {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "ログを検索 🔍" }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
});
