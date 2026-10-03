import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DepartmentSearchPanel } from "./DepartmentSearchPanel";

describe("DepartmentSearchPanel", () => {
  it("指定日と表示フィルタのタブを表示する", () => {
    render(
      <DepartmentSearchPanel
        targetDate="2026-09-01"
        setTargetDate={vi.fn()}
        filterStatus="active"
        setFilterStatus={vi.fn()}
        departmentsCount={3}
      />,
    );
    expect(screen.getByText("🟢 有効組織")).toBeInTheDocument();
    expect(screen.getByText("🔴 無効")).toBeInTheDocument();
  });

  it("日付変更でsetTargetDateを呼ぶ", async () => {
    const setTargetDate = vi.fn();
    render(
      <DepartmentSearchPanel
        targetDate="2026-09-01"
        setTargetDate={setTargetDate}
        filterStatus="active"
        setFilterStatus={vi.fn()}
        departmentsCount={0}
      />,
    );
    const input = screen.getByDisplayValue("2026-09-01");
    await userEvent.clear(input);
    await userEvent.type(input, "2026-01-01");
    expect(setTargetDate).toHaveBeenCalled();
  });

  it("フィルタタブクリックでsetFilterStatusを呼ぶ", async () => {
    const setFilterStatus = vi.fn();
    render(
      <DepartmentSearchPanel
        targetDate="2026-09-01"
        setTargetDate={vi.fn()}
        filterStatus="active"
        setFilterStatus={setFilterStatus}
        departmentsCount={0}
      />,
    );
    await userEvent.click(screen.getByText("🌐 全履歴"));
    expect(setFilterStatus).toHaveBeenCalledWith("all");
  });
});
