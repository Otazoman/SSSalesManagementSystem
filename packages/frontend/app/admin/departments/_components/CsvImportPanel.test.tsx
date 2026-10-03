import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CsvImportPanel } from "./CsvImportPanel";

describe("CsvImportPanel", () => {
  it("通常時はファイル選択案内を表示し、input(file)は有効", () => {
    const { container } = render(
      <CsvImportPanel canCreate editingSurrogateId={null} onImportCsv={vi.fn()} />,
    );
    expect(screen.getByText("組織CSVファイルを選択")).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toBeEnabled();
  });

  it("編集モード中は「インポート不可」表示になりinputが無効化される", () => {
    const { container } = render(
      <CsvImportPanel canCreate editingSurrogateId="s1" onImportCsv={vi.fn()} />,
    );
    expect(screen.getByText("インポート不可")).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toBeDisabled();
  });

  it("canCreate:falseの場合は権限不足メッセージを表示しinputを無効化する", () => {
    const { container } = render(
      <CsvImportPanel canCreate={false} editingSurrogateId={null} onImportCsv={vi.fn()} />,
    );
    expect(screen.getByText("🔒 CSVインポートする権限がありません")).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toBeDisabled();
  });
});
