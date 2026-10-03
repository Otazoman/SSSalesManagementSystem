import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateTool } from "./TemplateTool";

describe("TemplateTool", () => {
  it("コピーボタンクリックでonCopyを呼ぶ", async () => {
    const onCopy = vi.fn();
    render(
      <TemplateTool canUpdate copiedRoleName="" hasCopiedTemplate={false} onCopy={onCopy} onPaste={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "ステップ①: 現在のマトリクスをコピー" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("hasCopiedTemplate:falseの場合は貼り付けボタンが無効", () => {
    render(
      <TemplateTool canUpdate copiedRoleName="" hasCopiedTemplate={false} onCopy={vi.fn()} onPaste={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "ステップ②: ひな型を貼り付け" })).toBeDisabled();
  });

  it("hasCopiedTemplate:trueの場合は貼り付けボタンが有効になりコピー元ロール名を表示する", async () => {
    const onPaste = vi.fn();
    render(
      <TemplateTool
        canUpdate
        copiedRoleName="一般ユーザー"
        hasCopiedTemplate
        onCopy={vi.fn()}
        onPaste={onPaste}
      />,
    );
    expect(screen.getByText(/一般ユーザー/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ステップ②: ひな型を貼り付け" }));
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it("canUpdate:falseの場合は両ボタンとも無効", () => {
    render(
      <TemplateTool canUpdate={false} copiedRoleName="" hasCopiedTemplate onCopy={vi.fn()} onPaste={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "ステップ①: 現在のマトリクスをコピー" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ステップ②: ひな型を貼り付け" })).toBeDisabled();
  });
});
