import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowSearchForm } from "./WorkflowSearchForm";
import { SearchFilters } from "../_types";

const filters: SearchFilters = {
  startDate: "",
  endDate: "",
  applicantId: "",
  targetName: "",
  requestType: "",
  status: "ACTIVE_TASKS",
};

describe("WorkflowSearchForm", () => {
  it("targetNameを入力するとsetFiltersが呼ばれる", async () => {
    const setFilters = vi.fn();
    render(
      <WorkflowSearchForm
        filters={filters}
        setFilters={setFilters}
        onClear={vi.fn()}
        isAdmin={false}
        userMaster={[]}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("名称キーワード"), "A");
    expect(setFilters).toHaveBeenCalled();
  });

  it("userMasterの選択肢を申請者プルダウンに表示する", () => {
    render(
      <WorkflowSearchForm
        filters={filters}
        setFilters={vi.fn()}
        onClear={vi.fn()}
        isAdmin
        userMaster={[{ id: "user-12345678", name: "山田太郎" }]}
      />,
    );
    expect(screen.getByText(/山田太郎/)).toBeInTheDocument();
  });

  it("「条件を初期化」クリックでonClearを呼ぶ", async () => {
    const onClear = vi.fn();
    render(
      <WorkflowSearchForm
        filters={filters}
        setFilters={vi.fn()}
        onClear={onClear}
        isAdmin={false}
        userMaster={[]}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "🧹 条件を初期化(未処理のみに戻す)" }),
    );
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
