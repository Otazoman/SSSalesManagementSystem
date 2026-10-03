import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CsvImportPanel } from "./CsvImportPanel";

describe("CsvImportPanel(roles)", () => {
  it("通常時はファイル選択案内を表示する", () => {
    render(<CsvImportPanel canCreate editingId={null} onImportCsv={vi.fn()} />);
    expect(screen.getByText("業務ロールCSVファイルを選択")).toBeInTheDocument();
  });

  it("編集モード中は「インポート不可」表示になりinputが無効化される", () => {
    const { container } = render(
      <CsvImportPanel canCreate editingId="finance_checker" onImportCsv={vi.fn()} />,
    );
    expect(screen.getByText("インポート不可")).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toBeDisabled();
  });

  it("ファイル選択時はonImportCsvをFileで呼び、inputをリセットする", async () => {
    const onImportCsv = vi.fn(async () => {});
    const { container } = render(
      <CsvImportPanel canCreate editingId={null} onImportCsv={onImportCsv} />,
    );
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["id,name,description"], "roles.csv", { type: "text/csv" });
    await userEvent.upload(input, file);

    expect(onImportCsv).toHaveBeenCalledWith(file);
  });
});
