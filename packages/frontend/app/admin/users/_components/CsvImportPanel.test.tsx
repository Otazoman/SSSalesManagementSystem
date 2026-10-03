import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CsvImportPanel } from "./CsvImportPanel";

describe("CsvImportPanel(users)", () => {
  it("通常時はファイル選択案内を表示する", () => {
    render(<CsvImportPanel hasCreate editingUserId={null} onImportCsv={vi.fn()} />);
    expect(screen.getByText("従業員CSVファイルを選択")).toBeInTheDocument();
  });

  it("編集モード中は「インポート不可」表示になりinputが無効化される", () => {
    const { container } = render(
      <CsvImportPanel hasCreate editingUserId="u1" onImportCsv={vi.fn()} />,
    );
    expect(screen.getByText("インポート不可")).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toBeDisabled();
  });

  it("hasCreate:falseの場合は権限不足メッセージを表示する", () => {
    render(<CsvImportPanel hasCreate={false} editingUserId={null} onImportCsv={vi.fn()} />);
    expect(screen.getByText("🔒 CSVインポートする権限がありません")).toBeInTheDocument();
  });
});
