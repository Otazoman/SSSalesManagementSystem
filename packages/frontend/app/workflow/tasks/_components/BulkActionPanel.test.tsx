import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BulkActionPanel } from "./BulkActionPanel";

describe("BulkActionPanel", () => {
  it("selectedCountを表示する", () => {
    render(
      <BulkActionPanel
        selectedCount={3}
        bulkComment=""
        isProcessing={false}
        onCommentChange={vi.fn()}
        onBulkAction={vi.fn()}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("selectedCount:0の場合は一括操作ボタンが無効になる", () => {
    render(
      <BulkActionPanel
        selectedCount={0}
        bulkComment=""
        isProcessing={false}
        onCommentChange={vi.fn()}
        onBulkAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "🚀 一括承認する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "↩️ 一括差戻しする" })).toBeDisabled();
  });

  it("「一括承認する」クリックでonBulkAction('bulk-approve')を呼ぶ", async () => {
    const onBulkAction = vi.fn();
    render(
      <BulkActionPanel
        selectedCount={2}
        bulkComment=""
        isProcessing={false}
        onCommentChange={vi.fn()}
        onBulkAction={onBulkAction}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "🚀 一括承認する" }));
    expect(onBulkAction).toHaveBeenCalledWith("bulk-approve");
  });

  it("isProcessing:trueの間はコメント入力・両ボタンが無効になる", () => {
    render(
      <BulkActionPanel
        selectedCount={2}
        bulkComment=""
        isProcessing
        onCommentChange={vi.fn()}
        onBulkAction={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("一括処理時のコメント(任意)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "🚀 一括承認する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "↩️ 一括差戻しする" })).toBeDisabled();
  });
});
