import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBanner } from "./MessageBanner";

describe("MessageBanner", () => {
  it("すべて未指定の場合は何も描画しない", () => {
    const { container } = render(<MessageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("messageのみ指定時は成功バナーのみ表示する", () => {
    render(<MessageBanner message="単位を登録しました" />);
    expect(screen.getByText("単位を登録しました")).toBeInTheDocument();
  });

  it("message/warning/errorを同時に指定すると3つとも表示する", () => {
    render(
      <MessageBanner message="成功メッセージ" warning="警告メッセージ" error="エラーメッセージ" />,
    );
    expect(screen.getByText("成功メッセージ")).toBeInTheDocument();
    expect(screen.getByText("警告メッセージ")).toBeInTheDocument();
    expect(screen.getByText("エラーメッセージ")).toBeInTheDocument();
  });
});
