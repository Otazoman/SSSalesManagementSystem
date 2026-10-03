import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplicantDepartmentSelect } from "./ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../types";

const twoDepartments: ApplicantDepartmentOption[] = [
  { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
  { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
];

describe("ApplicantDepartmentSelect", () => {
  it("所属部署が0件の場合は何も描画しない", () => {
    const { container } = render(
      <ApplicantDepartmentSelect departments={[]} value={null} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("所属部署が1件の場合は何も描画しない(選択の余地が無いため)", () => {
    const { container } = render(
      <ApplicantDepartmentSelect
        departments={[twoDepartments[0]]}
        value="dept-a"
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("所属部署が2件以上の場合は選択肢とラベルを表示する", () => {
    render(
      <ApplicantDepartmentSelect
        departments={twoDepartments}
        value="dept-a"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("申請部署")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "営業統括部 (D001)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "人事総務部 (D002)" }),
    ).toBeInTheDocument();
  });

  it("選択変更でonChangeをsurrogateIdで呼ぶ", async () => {
    const onChange = vi.fn();
    render(
      <ApplicantDepartmentSelect
        departments={twoDepartments}
        value="dept-a"
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "dept-b");
    expect(onChange).toHaveBeenCalledWith("dept-b");
  });

  it("disabled指定でselectを無効化する", () => {
    render(
      <ApplicantDepartmentSelect
        departments={twoDepartments}
        value="dept-a"
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
