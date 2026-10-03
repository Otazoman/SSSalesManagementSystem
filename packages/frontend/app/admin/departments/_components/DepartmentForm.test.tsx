import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DepartmentForm from "./DepartmentForm";
import { DepartmentFormState, DepartmentRecord } from "../_types";

const departments: DepartmentRecord[] = [
  {
    id: "0001",
    name: "本社",
    parentDepartmentId: null,
    memo: null,
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
  },
];

function emptyFormState(): DepartmentFormState {
  return {
    deptId: "",
    deptName: "",
    deptParent: "",
    deptMemo: "",
    deptValidFrom: "",
    deptValidTo: "",
  };
}

describe("DepartmentForm", () => {
  it("新規登録時は「新規部署・組織階層定義」見出しを表示する", () => {
    render(
      <DepartmentForm
        editingSurrogateId={null}
        canCreate
        canUpdate
        departments={departments}
        formState={emptyFormState()}
        setFormState={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("新規部署・組織階層定義")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeInTheDocument();
  });

  it("編集時は「部署データの編集」見出しと部署コード入力欄の無効化を表示する", () => {
    render(
      <DepartmentForm
        editingSurrogateId="s1"
        canCreate
        canUpdate
        departments={departments}
        formState={{ ...emptyFormState(), deptId: "0001", deptName: "本社" }}
        setFormState={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("部署データの編集")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例: 0006")).toBeDisabled();
  });

  it("親組織セレクトは自分自身のIDを候補から除外する", () => {
    render(
      <DepartmentForm
        editingSurrogateId={null}
        canCreate
        canUpdate
        departments={departments}
        formState={{ ...emptyFormState(), deptId: "0001" }}
        setFormState={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText("本社 (ID: 0001)")).not.toBeInTheDocument();
  });

  it("権限がない場合は「閲覧専用」バッジを表示しボタンを無効化する", () => {
    render(
      <DepartmentForm
        editingSurrogateId={null}
        canCreate={false}
        canUpdate={false}
        departments={departments}
        formState={emptyFormState()}
        setFormState={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("閲覧専用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeDisabled();
  });

  it("部署名を入力するとsetFormStateが呼ばれる", async () => {
    const setFormState = vi.fn();
    render(
      <DepartmentForm
        editingSurrogateId={null}
        canCreate
        canUpdate
        departments={departments}
        formState={emptyFormState()}
        setFormState={setFormState}
        onSubmit={vi.fn()}
      />,
    );
    await userEvent.type(
      screen.getByPlaceholderText("例: 開発第一チーム"),
      "A",
    );
    expect(setFormState).toHaveBeenCalled();
  });

  it("フォーム送信でonSubmitを呼ぶ", async () => {
    const onSubmit = vi.fn((e: React.SyntheticEvent) => e.preventDefault());
    render(
      <DepartmentForm
        editingSurrogateId={null}
        canCreate
        canUpdate
        departments={departments}
        formState={{
          ...emptyFormState(),
          deptId: "0002",
          deptName: "新部署",
          deptValidFrom: "2026-01-01",
        }}
        setFormState={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "登録" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
