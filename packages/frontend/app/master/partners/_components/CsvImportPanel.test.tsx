import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import CsvImportPanel from "./CsvImportPanel";

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(overrides: Partial<Parameters<typeof CsvImportPanel>[0]> = {}) {
  render(
    <CsvImportPanel
      canCreate
      editingId={null}
      isPartnerWfEnabled={false}
      onSuccess={vi.fn()}
      onError={vi.fn()}
      {...overrides}
    />,
  );
}

describe("CsvImportPanel(partners)", () => {
  it("通常時はファイル選択可能な文言を表示する", () => {
    setup();
    expect(screen.getByText("取引先CSVファイルを選択")).toBeInTheDocument();
  });

  it("編集モード中は「編集中は利用できません」と表示しinputを無効化する", () => {
    const { container } = render(
      <CsvImportPanel
        canCreate
        editingId="CUST-001"
        isPartnerWfEnabled={false}
        onSuccess={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByText("※編集中は利用できません")).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toBeDisabled();
  });

  it("承認ワークフロー有効時は「承認機能が有効な間は利用できません」と表示する", () => {
    setup({ isPartnerWfEnabled: true });
    expect(screen.getByText("※承認機能が有効な間は利用できません")).toBeInTheDocument();
  });

  it("canCreate:falseの場合はインポート不可と表示する", () => {
    setup({ canCreate: false });
    expect(screen.getByText("インポート不可")).toBeInTheDocument();
  });
});
