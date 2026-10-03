import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CsvImportPanel } from "./CsvImportPanel";

describe("CsvImportPanel(permissions)", () => {
  it("通常時はファイル選択案内を表示する", () => {
    render(<CsvImportPanel canCreate onImportCsv={vi.fn()} />);
    expect(screen.getByText("権限マトリクスCSVファイルを選択")).toBeInTheDocument();
  });

  it("canCreate:falseの場合は権限なし表示になりinputが無効化される", () => {
    const { container } = render(<CsvImportPanel canCreate={false} onImportCsv={vi.fn()} />);
    expect(screen.getByText("🔒 CSVインポートする権限がありません")).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toBeDisabled();
  });

  it("ファイル選択時はonImportCsvをFileで呼び、inputをリセットする", async () => {
    const onImportCsv = vi.fn(async () => {});
    const { container } = render(<CsvImportPanel canCreate onImportCsv={onImportCsv} />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["role_id,permission_id"], "matrix.csv", { type: "text/csv" });
    await userEvent.upload(input, file);

    expect(onImportCsv).toHaveBeenCalledWith(file);
  });
});
