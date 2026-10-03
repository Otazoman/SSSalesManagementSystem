import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CsvImportPanel } from "./CsvImportPanel";

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(overrides: Partial<Parameters<typeof CsvImportPanel>[0]> = {}) {
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const onImportComplete = vi.fn();
  const utils = render(
    <CsvImportPanel
      canCreate
      isProductWfEnabled={false}
      onSuccess={onSuccess}
      onError={onError}
      onImportComplete={onImportComplete}
      {...overrides}
    />,
  );
  return { onSuccess, onError, onImportComplete, ...utils };
}

describe("CsvImportPanel(products)", () => {
  it("通常時はクリックしてファイル選択できる旨を表示する", () => {
    setup();
    expect(screen.getByText("※クリックしてパソコンからファイルを選択してください")).toBeInTheDocument();
  });

  it("canCreate:falseの場合は権限がない旨を表示しinputを無効化する", () => {
    const { container } = setup({ canCreate: false });
    expect(screen.getByText("⚠️ CSVインポートする権限がありません")).toBeInTheDocument();
    expect(container.querySelector("input[type=file]")).toBeDisabled();
  });

  it("承認ワークフロー有効時は利用不可の旨を表示する", () => {
    setup({ isProductWfEnabled: true });
    expect(screen.getByText("※承認機能が有効な間は利用できません")).toBeInTheDocument();
    expect(screen.getByText("⚠️ 承認機能が有効な間は利用できません")).toBeInTheDocument();
  });

  it("ファイル選択でインポートAPIを叩きonImportCompleteを呼ぶ", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "3件取り込みました" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { container, onImportComplete, onSuccess } = setup();
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["id,name"], "products.csv", { type: "text/csv" });

    await userEvent.upload(input, file);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/products/bulk-register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onSuccess).toHaveBeenCalledWith("3件取り込みました");
    expect(onImportComplete).toHaveBeenCalledTimes(1);
  });
});
