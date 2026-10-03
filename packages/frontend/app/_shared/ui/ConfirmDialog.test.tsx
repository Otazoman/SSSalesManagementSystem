import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ConfirmProvider } from "./ConfirmDialog";
import { useConfirm } from "../hooks/use-confirm";

afterEach(() => {
  vi.restoreAllMocks();
});

function DeleteButton() {
  const confirm = useConfirm();
  const [result, setResult] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={async () => setResult((await confirm("削除しますか？\n元に戻せません", { confirmLabel: "削除する" })) ? "yes" : "no")}
      >
        削除
      </button>
      <p data-testid="result">{result}</p>
    </>
  );
}

describe("ConfirmProvider / useConfirm(BUG-045)", () => {
  it("ブラウザの confirm ではなく画面上に確認を出し、実行を選ぶと true", async () => {
    const browserConfirm = vi.spyOn(window, "confirm");
    render(
      <ConfirmProvider>
        <DeleteButton />
      </ConfirmProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(await screen.findByText(/削除しますか？/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("yes"));
    expect(browserConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText(/削除しますか？/)).not.toBeInTheDocument();
  });

  it("キャンセル・✕は false", async () => {
    render(
      <ConfirmProvider>
        <DeleteButton />
      </ConfirmProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    fireEvent.click(await screen.findByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("no"));

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    fireEvent.click(await screen.findByRole("button", { name: "ダイアログを閉じる" }));
    await waitFor(() => expect(screen.queryByText(/削除しますか？/)).not.toBeInTheDocument());
    expect(screen.getByTestId("result")).toHaveTextContent("no");
  });

  it("ConfirmProvider の外では、ブラウザの confirm を使う(単体のテスト用)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeleteButton />);
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("yes"));
  });
});
