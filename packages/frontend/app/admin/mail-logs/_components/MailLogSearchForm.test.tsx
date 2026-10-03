import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MailLogSearchForm } from "./MailLogSearchForm";

function baseProps() {
  return {
    startDate: "",
    setStartDate: vi.fn(),
    endDate: "",
    setEndDate: vi.fn(),
    documentId: "",
    setDocumentId: vi.fn(),
    keyword: "",
    setKeyword: vi.fn(),
    status: "",
    setStatus: vi.fn(),
    loading: false,
    onSubmit: vi.fn((e: React.FormEvent) => e.preventDefault()),
    onClear: vi.fn(),
  };
}

describe("MailLogSearchForm", () => {
  it("ステータス選択肢を表示する", () => {
    render(<MailLogSearchForm {...baseProps()} />);
    expect(screen.getByRole("option", { name: "成功" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "失敗" })).toBeInTheDocument();
  });

  it("伝票番号入力でsetDocumentIdを呼ぶ", async () => {
    const props = baseProps();
    render(<MailLogSearchForm {...props} />);
    await userEvent.type(screen.getByPlaceholderText("例: QT-2026-5473-0"), "Q");
    expect(props.setDocumentId).toHaveBeenCalledWith("Q");
  });

  it("ステータス選択でsetStatusを呼ぶ", async () => {
    const props = baseProps();
    render(<MailLogSearchForm {...props} />);
    await userEvent.selectOptions(screen.getByDisplayValue("すべて"), "FAILED");
    expect(props.setStatus).toHaveBeenCalledWith("FAILED");
  });

  it("loading:trueの場合は検索ボタンが無効になる", () => {
    render(<MailLogSearchForm {...baseProps()} loading />);
    expect(screen.getByRole("button", { name: "処理中..." })).toBeDisabled();
  });

  it("条件をクリアクリックでonClearを呼ぶ", async () => {
    const props = baseProps();
    render(<MailLogSearchForm {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
