import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccessDeniedInline } from "./AccessDeniedInline";

describe("AccessDeniedInline", () => {
  it("デフォルトのタイトル・説明文を表示する", () => {
    render(<AccessDeniedInline />);
    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
    expect(
      screen.getByText("この画面を表示する権限(read / menu)が割り当てられていません。"),
    ).toBeInTheDocument();
  });

  it("title/descriptionを上書きできる", () => {
    render(<AccessDeniedInline title="カスタムタイトル" description="カスタム説明" />);
    expect(screen.getByText("カスタムタイトル")).toBeInTheDocument();
    expect(screen.getByText("カスタム説明")).toBeInTheDocument();
  });

  it("description空文字時は説明文のpタグを描画しない", () => {
    const { container } = render(<AccessDeniedInline description="" />);
    expect(container.querySelector("p")).toBeNull();
  });
});
