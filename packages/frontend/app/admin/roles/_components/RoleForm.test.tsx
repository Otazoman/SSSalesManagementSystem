import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleForm } from "./RoleForm";
import { RoleRecord } from "../_types";

const roles: RoleRecord[] = [
  {
    id: "finance_checker",
    name: "経理検収担当",
    description: "説明文",
    createdAt: "",
  },
];

function baseProps() {
  return {
    canCreate: true,
    canUpdate: true,
    editingId: null,
    roles,
    onCreate: vi.fn(async () => {}),
    onUpdate: vi.fn(async () => {}),
    onClose: vi.fn(),
    setError: vi.fn(),
  };
}

describe("RoleForm", () => {
  it("新規登録時は空欄で「新規個別ロール登録」を表示する", () => {
    render(<RoleForm {...baseProps()} />);
    expect(screen.getByText("新規個別ロール登録")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例: finance_checker")).toHaveValue("");
  });

  it("編集時はeditingIdに一致するロールの値をフォームへ反映する", () => {
    render(<RoleForm {...baseProps()} editingId="finance_checker" />);
    expect(screen.getByText("業務ロール情報の編集")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例: finance_checker")).toHaveValue(
      "finance_checker",
    );
    expect(screen.getByPlaceholderText("例: 経理検収担当")).toHaveValue(
      "経理検収担当",
    );
    expect(screen.getByPlaceholderText("例: finance_checker")).toBeDisabled();
  });

  it("必須項目が空のまま送信するとsetErrorを呼びonCreateは呼ばない", async () => {
    const props = baseProps();
    render(<RoleForm {...props} />);
    // required属性によるネイティブバリデーションを避けるためnoValidateはないが、
    // roleId/roleNameを一旦入力してから空に戻すのは煩雑なため、フォーム側のtrim検証を直接叩く
    const idInput = screen.getByPlaceholderText("例: finance_checker");
    const nameInput = screen.getByPlaceholderText("例: 経理検収担当");
    await userEvent.type(idInput, " ");
    await userEvent.type(nameInput, " ");
    await userEvent.click(screen.getByRole("button", { name: "登録" }));
    expect(props.setError).toHaveBeenCalledWith(
      "ロールIDおよびロール名は必須入力項目です",
    );
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("新規登録: 入力して送信するとonCreateをtrim済みの値で呼ぶ", async () => {
    const props = baseProps();
    render(<RoleForm {...props} />);
    await userEvent.type(
      screen.getByPlaceholderText("例: finance_checker"),
      "new_role",
    );
    await userEvent.type(
      screen.getByPlaceholderText("例: 経理検収担当"),
      "新ロール",
    );
    await userEvent.click(screen.getByRole("button", { name: "登録" }));
    expect(props.onCreate).toHaveBeenCalledWith("new_role", "新ロール", "");
  });

  it("編集: 送信するとonUpdateを呼ぶ", async () => {
    const props = baseProps();
    render(<RoleForm {...props} editingId="finance_checker" />);
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(props.onUpdate).toHaveBeenCalledWith(
      "finance_checker",
      "経理検収担当",
      "説明文",
    );
  });

  it("canCreate:falseの新規登録では「閲覧専用」を表示しボタンを無効化する", () => {
    render(<RoleForm {...baseProps()} canCreate={false} />);
    expect(screen.getByText("閲覧専用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeDisabled();
  });
});
