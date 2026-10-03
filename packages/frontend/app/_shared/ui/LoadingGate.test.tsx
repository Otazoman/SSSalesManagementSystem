import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingGate } from "./LoadingGate";

describe("LoadingGate", () => {
  it("デフォルトラベルを表示する", () => {
    render(<LoadingGate />);
    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
  });

  it("labelを上書きできる", () => {
    render(<LoadingGate label="読み込み中..." />);
    expect(screen.getByText("読み込み中...")).toBeInTheDocument();
  });
});
