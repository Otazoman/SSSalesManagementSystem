import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPanel } from "./SearchPanel";
import { DepartmentRecord, RoleRecord } from "../_types";

const departments: DepartmentRecord[] = [{ id: "d1", name: "開発部" }];
const roles: RoleRecord[] = [{ id: "general_user", name: "一般", description: "" }];

function baseProps(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  return {
    searchEmpNum: "",
    setSearchEmpNum: vi.fn(),
    searchName: "",
    setSearchName: vi.fn(),
    searchNameMode: "partial" as const,
    setSearchNameMode: vi.fn(),
    searchEmail: "",
    setSearchEmail: vi.fn(),
    searchEmailMode: "partial" as const,
    setSearchEmailMode: vi.fn(),
    searchDeptId: "",
    setSearchDeptId: vi.fn(),
    searchRoleId: "",
    setSearchRoleId: vi.fn(),
    onClearSearch: vi.fn(),
    departments,
    roles,
    ...overrides,
  };
}

describe("SearchPanel(users)", () => {
  it("部署・ロールの選択肢を表示する", () => {
    render(<SearchPanel {...baseProps()} />);
    expect(screen.getByText("開発部")).toBeInTheDocument();
    expect(screen.getByText("一般")).toBeInTheDocument();
  });

  it("従業員番号を入力するとsetSearchEmpNumを呼ぶ", async () => {
    const setSearchEmpNum = vi.fn();
    render(<SearchPanel {...baseProps({ setSearchEmpNum })} />);
    await userEvent.type(screen.getByPlaceholderText("例: EMP202600"), "1");
    expect(setSearchEmpNum).toHaveBeenCalledWith("1");
  });

  it("氏名の完全一致ラジオを選ぶとsetSearchNameModeを呼ぶ", async () => {
    const setSearchNameMode = vi.fn();
    render(<SearchPanel {...baseProps({ setSearchNameMode })} />);
    const exactRadios = screen.getAllByText("完全");
    await userEvent.click(exactRadios[0]);
    expect(setSearchNameMode).toHaveBeenCalledWith("exact");
  });

  it("条件をクリアクリックでonClearSearchを呼ぶ", async () => {
    const onClearSearch = vi.fn();
    render(<SearchPanel {...baseProps({ onClearSearch })} />);
    await userEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });
});
