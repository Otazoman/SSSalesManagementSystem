import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BomCsvPanel } from "./BomCsvPanel";

function setup(overrides: Partial<Parameters<typeof BomCsvPanel>[0]> = {}) {
  const onImportCsv = vi.fn();
  const utils = render(
    <BomCsvPanel
      canCsvAction
      editingId={null}
      isItemStructureWfEnabled={false}
      onImportCsv={onImportCsv}
      {...overrides}
    />,
  );
  return { onImportCsv, ...utils };
}

describe("BomCsvPanel", () => {
  it("通常時は選択可能な文言を表示する", () => {
    setup();
    expect(screen.getByText("BOM構成CSVファイルを選択")).toBeInTheDocument();
  });

  it("編集中はインポート不可、バッジも表示する", () => {
    setup({ editingId: "STR-1" });
    expect(screen.getByText("※編集中は利用できません")).toBeInTheDocument();
    expect(screen.getByText("インポート不可")).toBeInTheDocument();
  });

  it("承認ワークフロー有効時は利用不可と表示する", () => {
    setup({ isItemStructureWfEnabled: true });
    expect(screen.getByText("※承認機能が有効な間は利用できません")).toBeInTheDocument();
    expect(screen.getByText("承認機能が有効な間は利用できません")).toBeInTheDocument();
  });

  it("canCsvAction:falseの場合は権限がない旨を表示する", () => {
    setup({ canCsvAction: false });
    expect(screen.getByText("🔒 CSVインポートする権限がありません")).toBeInTheDocument();
  });

  it("ファイル選択でonImportCsvを呼ぶ", async () => {
    const { onImportCsv, container } = setup();
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["id,parentItemId"], "bom.csv", { type: "text/csv" });
    await userEvent.upload(input, file);
    expect(onImportCsv).toHaveBeenCalledTimes(1);
  });
});
