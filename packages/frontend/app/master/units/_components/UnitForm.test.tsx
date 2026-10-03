import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnitForm } from "./UnitForm";

function baseProps() {
  return {
    code: "",
    name: "",
    status: "active",
    editingUnit: null,
    canCreate: true,
    canUpdate: true,
    setCode: vi.fn(),
    setName: vi.fn(),
    setStatus: vi.fn(),
    onSubmit: vi.fn((e: React.SyntheticEvent) => e.preventDefault()),
    onCancel: vi.fn(),
  };
}

describe("UnitForm", () => {
  it("新規登録時は「新規個別単位登録」の見出しと登録ボタンを表示する", () => {
    render(<UnitForm {...baseProps()} />);
    expect(screen.getByText("新規個別単位登録")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeInTheDocument();
  });

  it("編集時(承認ワークフロー無効)は「変更を直接保存」ボタンとキャンセルボタンを表示する", () => {
    render(
      <UnitForm {...baseProps()} editingUnit={{ code: "PCS", name: "個" }} />,
    );
    expect(screen.getByText("単位情報の編集")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "キャンセル" }),
    ).toBeInTheDocument();
  });

  it("承認ワークフロー有効時の新規登録は申請ボタン文言になる", () => {
    render(<UnitForm {...baseProps()} isUnitWfEnabled />);
    expect(
      screen.getByRole("button", { name: "✨ 承認を申請する" }),
    ).toBeInTheDocument();
  });

  it("入力するとsetCode/setNameが呼ばれる", async () => {
    const props = baseProps();
    render(<UnitForm {...props} />);
    await userEvent.type(screen.getByPlaceholderText("例: PCS, KG, M"), "P");
    expect(props.setCode).toHaveBeenCalledWith("P");
  });

  it("編集時は単位コード入力欄が無効化される(コード変更不可)", () => {
    render(
      <UnitForm {...baseProps()} editingUnit={{ code: "PCS", name: "個" }} />,
    );
    expect(screen.getByPlaceholderText("例: PCS, KG, M")).toBeDisabled();
  });

  it("isUnitCurrentlyLocked:trueの場合はロック警告文を表示しfieldsetを無効化する", () => {
    const { container } = render(
      <UnitForm
        {...baseProps()}
        editingUnit={{ code: "PCS", name: "個" }}
        isUnitWfEnabled
        isUnitCurrentlyLocked
      />,
    );
    expect(
      screen.getByText(
        /承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます/,
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("fieldset")).toBeDisabled();
  });

  it("canCreate:falseの新規登録では「閲覧専用」バッジを表示し登録ボタンを無効化する", () => {
    render(<UnitForm {...baseProps()} canCreate={false} />);
    expect(screen.getByText("閲覧専用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeDisabled();
  });

  it("フォーム送信でonSubmitが呼ばれる", async () => {
    const props = baseProps();
    render(<UnitForm {...props} code="PCS" name="個" />);
    await userEvent.click(screen.getByRole("button", { name: "登録" }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("追加要望F: 承認ワークフロー有効かつ複数部署所属時のみ申請部署選択を表示する", () => {
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const { rerender } = render(
      <UnitForm {...baseProps()} isUnitWfEnabled departments={departments} />,
    );
    expect(screen.getByText("申請部署")).toBeInTheDocument();

    rerender(
      <UnitForm
        {...baseProps()}
        isUnitWfEnabled
        departments={[departments[0]]}
      />,
    );
    expect(screen.queryByText("申請部署")).not.toBeInTheDocument();

    rerender(<UnitForm {...baseProps()} departments={departments} />);
    expect(screen.queryByText("申請部署")).not.toBeInTheDocument();
  });
});
