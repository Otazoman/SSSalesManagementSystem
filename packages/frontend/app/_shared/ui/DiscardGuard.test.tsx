import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { Modal } from "./Modal";
import { FormActions } from "./FormActions";
import {
  DISCARD_CONFIRM_MESSAGE,
  DiscardCancelButton,
  useDiscardGuard,
} from "./DiscardGuard";

// BUG-045: 確認(useConfirm)は結果を Promise で返すため、クリックの後に確認の結果を待つ
const flush = () => act(async () => {});

afterEach(() => {
  vi.restoreAllMocks();
});

function EditModal({
  onClose,
  warnOnDiscard = true,
  mode = "edit",
}: {
  onClose: () => void;
  warnOnDiscard?: boolean;
  mode?: "create" | "edit" | "view";
}) {
  return (
    <Modal
      title="編集"
      onClose={onClose}
      warnOnDiscard={warnOnDiscard}
      footer={<FormActions mode={mode} onCancel={onClose} onSubmit={() => {}} />}
    >
      <input aria-label="名称" defaultValue="初期値" />
      <DiscardCancelButton onCancel={onClose}>本文内のキャンセル</DiscardCancelButton>
    </Modal>
  );
}

describe("Modal(warnOnDiscard)+FormActions: 編集のキャンセル時の確認", () => {
  it("何も編集していなければ、確認せずにそのまま閉じる", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    render(<EditModal onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("編集後にキャンセルすると確認を出し、了承すれば閉じる", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    render(<EditModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "変更後" } });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();

    expect(confirmSpy).toHaveBeenCalledWith(DISCARD_CONFIRM_MESSAGE);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("確認で「続ける」を選ぶと閉じない(編集内容はそのまま残る)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    render(<EditModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "変更後" } });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("名称")).toHaveValue("変更後");
  });

  it("✕・本文内のキャンセルボタンも、編集後は同じ確認を出す", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    render(<EditModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "変更後" } });
    fireEvent.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "本文内のキャンセル" }));
    await flush();

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("「破棄する」を選んだ後に続けて閉じる操作をしても、確認は繰り返さない", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    render(<EditModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "変更後" } });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("参照だけの表示(閉じる)は、編集後でも確認しない", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    render(<EditModal onClose={onClose} mode="view" />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "変更後" } });
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("warnOnDiscardを指定しないモーダル(一覧から選ぶ画面など)は、入力があっても確認しない", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    render(<EditModal onClose={onClose} warnOnDiscard={false} />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "検索語" } });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

function InlineForm({ onClose }: { onClose: () => void }) {
  const [show, setShow] = useState(true);
  const guard = useDiscardGuard(show);
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          if (show && !(await guard.confirmDiscard())) return;
          setShow(!show);
          onClose();
        }}
      >
        {show ? "キャンセル" : "開く"}
      </button>
      {show && (
        <div {...guard.scopeProps}>
          <input aria-label="コード" />
          <select aria-label="状態" defaultValue="a">
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
        </div>
      )}
    </div>
  );
}

describe("useDiscardGuard(ページ内のフォーム)", () => {
  it("入力欄・選択欄の変更を検知し、破棄を了承すればフォームが閉じる", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    render(<InlineForm onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("状態"), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();

    expect(confirmSpy).toHaveBeenCalledWith(DISCARD_CONFIRM_MESSAGE);
    expect(screen.queryByLabelText("コード")).not.toBeInTheDocument();
  });

  it("「続ける」を選ぶと、フォームは開いたまま", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<InlineForm onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("コード"), { target: { value: "X1" } });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();

    expect(screen.getByLabelText("コード")).toHaveValue("X1");
  });

  it("開き直したときは、前回の編集を引き継がず、確認なしで閉じられる", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<InlineForm onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("コード"), { target: { value: "X1" } });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await flush();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});

// BUG-081: 保存した後もモーダルを開いたままにする画面(商談)で、保存の成功のたびに discardResetKey を変えると、
// それまでの編集は「未保存」に数えない(保存後に✕で閉じても確認を出さない)。保存後にまた編集すれば確認を出す
describe("Modal(discardResetKey): 保存後に閉じる", () => {
  function SavingModal({ onClose }: { onClose: () => void }) {
    const [savedVersion, setSavedVersion] = useState(0);
    return (
      <Modal title="商談" onClose={onClose} warnOnDiscard discardResetKey={savedVersion}>
        <input aria-label="名称" defaultValue="初期値" />
        <button type="button" onClick={() => setSavedVersion((v) => v + 1)}>
          保存
        </button>
      </Modal>
    );
  }

  it("編集して保存した後に✕で閉じても確認しない。保存後にまた編集すれば確認する", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = vi.fn();
    render(<SavingModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "変更後" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    await flush();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "さらに変更" } });
    fireEvent.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
