import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CsvImportPanel } from "./CsvImportPanel";

describe("CsvImportPanel(approval-flows)", () => {
  it("通常時はファイル選択案内を表示する", () => {
    render(<CsvImportPanel canCreate editingFlowId={null} onImportCsv={vi.fn()} />);
    expect(screen.getByText("承認フローCSVファイルを選択")).toBeInTheDocument();
  });

  it("編集モード中は「インポート不可」表示になりinputが無効化される", () => {
    const { container } = render(
      <CsvImportPanel canCreate editingFlowId="f1" onImportCsv={vi.fn()} />,
    );
    expect(screen.getByText("インポート不可")).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toBeDisabled();
  });

  it("canCreate:falseの場合は権限不足メッセージを表示する", () => {
    render(<CsvImportPanel canCreate={false} editingFlowId={null} onImportCsv={vi.fn()} />);
    expect(screen.getByText("🔒 CSVインポートする権限がありません")).toBeInTheDocument();
  });

  it("実際のCSVヘッダー順序(matchField/matchValue含む)と一致するフォーマット案内を表示する", () => {
    render(<CsvImportPanel canCreate editingFlowId={null} onImportCsv={vi.fn()} />);
    expect(
      screen.getByText(
        "name,requestType,minAmount,maxAmount,isActive,matchField,matchValue,approverRoleId,targetDepartmentId,stepName,stepMemo",
      ),
    ).toBeInTheDocument();
  });
});
