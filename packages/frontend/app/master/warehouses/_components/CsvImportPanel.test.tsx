import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CsvImportPanel from "./CsvImportPanel";

function baseProps() {
  return {
    title: "倉庫",
    headerFormat: "id,name",
    canCreate: true,
    editingId: null,
    onImport: vi.fn(async () => {}),
  };
}

describe("CsvImportPanel", () => {
  it("ヘッダーフォーマットを表示する", () => {
    render(<CsvImportPanel {...baseProps()} />);
    expect(screen.getByText("id,name")).toBeInTheDocument();
  });

  it("編集モード中は「編集中は利用できません」を表示し、input disabledになる", () => {
    render(<CsvImportPanel {...baseProps()} editingId="WH-1" />);
    expect(screen.getByText("※編集中は利用できません")).toBeInTheDocument();
    expect(screen.getByText("インポート不可")).toBeInTheDocument();
  });

  it("承認ワークフロー有効時は「承認機能が有効な間は利用できません」を表示する", () => {
    render(<CsvImportPanel {...baseProps()} isWarehouseWfEnabled />);
    expect(screen.getByText("※承認機能が有効な間は利用できません")).toBeInTheDocument();
  });

  it("ファイル選択でonImportをFileで呼ぶ", async () => {
    const props = baseProps();
    render(<CsvImportPanel {...props} />);

    const file = new File(["id,name\nWH-1,本社倉庫"], "warehouses.csv", { type: "text/csv" });
    const input = screen.getByText("CSVファイルを選択").parentElement!.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(props.onImport).toHaveBeenCalledWith(file);
  });

  it("canCreate:falseの場合はinputが無効になる", () => {
    render(<CsvImportPanel {...baseProps()} canCreate={false} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    expect(input).toBeDisabled();
  });
});
