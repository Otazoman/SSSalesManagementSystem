import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MasterFormModal } from "./MasterFormModal";

// REQ-024: マスタ画面の登録・編集のモーダル
function renderModal(props: { message?: string; error?: string; onClose?: () => void }) {
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <MasterFormModal title="単位の新規登録" onClose={onClose} message={props.message} error={props.error}>
      {(requestClose) => (
        <>
          <input aria-label="名前" />
          <button type="button" onClick={() => void requestClose()}>
            キャンセル
          </button>
        </>
      )}
    </MasterFormModal>,
  );
  return { ...utils, onClose };
}

describe("MasterFormModal", () => {
  it("開いた後に新しい成功のメッセージが出たら閉じる(保存・CSV 取込の成功)。開いた時からあるメッセージでは閉じない", () => {
    const onClose = vi.fn();
    const { rerender } = renderModal({ message: "前の操作のメッセージ", onClose });
    expect(onClose).not.toHaveBeenCalled();
    const again = (message: string) =>
      rerender(
        <MasterFormModal title="単位の新規登録" onClose={onClose} message={message}>
          {() => <input aria-label="名前" />}
        </MasterFormModal>,
      );
    again("");
    expect(onClose).not.toHaveBeenCalled();
    again("単位を新規登録しました");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("エラーはモーダルの中に出す", () => {
    renderModal({ error: "既に登録されています" });
    expect(screen.getByRole("dialog")).toHaveTextContent("既に登録されています");
  });

  it("入力した後のキャンセルは破棄の確認を出し、続けるなら閉じない", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onClose } = renderModal({});
    await userEvent.type(screen.getByLabelText("名前"), "BOX");
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(confirmSpy).toHaveBeenCalledWith("保存していない編集を破棄しますか？");
    expect(onClose).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
