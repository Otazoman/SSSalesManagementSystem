import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CsvImportPanel from "./CsvImportPanel";

function setup(overrides: Partial<Parameters<typeof CsvImportPanel>[0]> = {}) {
  const onImport = vi.fn(async () => {});
  const utils = render(
    <CsvImportPanel
      title="単価契約"
      headerFormat="id,itemId,priceType"
      canCreate
      editingId={null}
      isProductPriceWfEnabled={false}
      onImport={onImport}
      {...overrides}
    />,
  );
  return { onImport, ...utils };
}

describe("CsvImportPanel(product-prices)", () => {
  it("通常時は選択可能な文言を表示する", () => {
    setup();
    expect(screen.getByText("📁 単価契約CSVファイルを選択")).toBeInTheDocument();
  });

  it("編集中はインポート不可、バッジも表示する", () => {
    setup({ editingId: "PRICE-1" });
    expect(screen.getByText("※編集中は利用できません")).toBeInTheDocument();
    expect(screen.getByText("インポート不可")).toBeInTheDocument();
  });

  it("承認ワークフロー有効時はインポート不可", () => {
    setup({ isProductPriceWfEnabled: true });
    expect(screen.getByText("※承認機能が有効な間は利用できません")).toBeInTheDocument();
  });

  it("ファイル選択でonImportを呼ぶ", async () => {
    const { onImport, container } = setup();
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["id,itemId"], "prices.csv", { type: "text/csv" });
    await userEvent.upload(input, file);
    expect(onImport).toHaveBeenCalledWith(file);
  });
});
