import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FormActions } from "./FormActions";

// BUG-045: 確認(useConfirm)は結果を Promise で返すため、クリックの後に確認の結果を待つ
const flush = () => act(async () => {});

describe("FormActions(統一の文言: 新規=登録 / 既存=保存 / 参照=閉じる)", () => {
  it("create: 「キャンセル」と「登録」を出す。登録は type=submit", async () => {
    const onCancel = vi.fn();
    render(<FormActions mode="create" onCancel={onCancel} />);
    expect(screen.getByRole("button", { name: "登録" })).toHaveAttribute(
      "type",
      "submit",
    );
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("edit: 確定ボタンは「保存」", async () => {
    render(<FormActions mode="edit" onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登録" }),
    ).not.toBeInTheDocument();
  });

  it("view: 「閉じる」だけを出す(確定ボタンなし)", async () => {
    render(<FormActions mode="view" onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "キャンセル" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /登録|保存/ }),
    ).not.toBeInTheDocument();
  });

  it("loading: ラベルが「登録中...」「保存中...」になり、押せない", async () => {
    const { rerender } = render(<FormActions mode="create" loading />);
    expect(screen.getByRole("button", { name: "登録中..." })).toBeDisabled();
    rerender(<FormActions mode="edit" loading />);
    expect(screen.getByRole("button", { name: "保存中..." })).toBeDisabled();
  });

  it("submitDisabled で確定だけ押せなくなる。onCancel 省略でキャンセルは出ない", async () => {
    render(<FormActions mode="create" submitDisabled />);
    expect(screen.getByRole("button", { name: "登録" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "キャンセル" }),
    ).not.toBeInTheDocument();
  });

  it("formId: フォーム外(Modalのfooter)に置いても、対象フォームを送信する", async () => {
    render(<FormActions mode="edit" formId="my-form" />);
    expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute(
      "form",
      "my-form",
    );
  });

  it("onSubmit を渡すと type=button で、その処理を呼ぶ(フォームを使わない画面用)", async () => {
    const onSubmit = vi.fn();
    render(<FormActions mode="create" onSubmit={onSubmit} />);
    const btn = screen.getByRole("button", { name: "登録" });
    expect(btn).toHaveAttribute("type", "button");
    fireEvent.click(btn);
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("extra(削除ボタン等)を左側に出せる", async () => {
    render(<FormActions mode="edit" extra={<button>削除</button>} />);
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
  });

  it("スマホは確定ボタンが上(DOMは キャンセル→確定 の順で flex-col-reverse)、sm以上は右寄せの横並び", async () => {
    const { container } = render(
      <FormActions mode="create" onCancel={() => {}} />,
    );
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.className).toContain("flex-col-reverse");
    expect(wrap.className).toContain("sm:flex-row");
    expect(wrap.className).toContain("sm:justify-end");
    const names = Array.from(wrap.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(names).toEqual(["キャンセル", "登録"]);
  });
});
