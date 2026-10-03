import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PaymentDetailModal } from "./PaymentDetailModal";
import { PaymentDetail } from "../_types";

// BUG-045: 確認(useConfirm)は結果を Promise で返すため、クリックの後に確認の結果を待つ
const flush = () => act(async () => {});

const DETAIL: PaymentDetail = {
  id: "PAY-1",
  partnerId: "P-1",
  title: "テスト支払",
  paymentDate: "2026-09-01T00:00:00.000Z",
  mode: "PER_TRANSACTION",
  status: "DRAFT",
  totalAmount: 11000,
  taxAmount: 1000,
  reconciledAmount: 0,
  reconciliationStatus: "UNRECONCILED",
  memo: null,
  items: [],
  disbursements: [],
};

function renderModal(onClose = vi.fn()) {
  render(
    <PaymentDetailModal
      detail={DETAIL}
      onClose={onClose}
      onRecordDisbursement={vi.fn(async () => true)}
    />,
  );
  return onClose;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PaymentDetailModal(編集キャンセル時の確認)", () => {
  it("支払消込欄を編集後に✕を押すと確認し、続けるを選ぶと閉じない", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = renderModal();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    await flush();

    expect(confirmSpy).toHaveBeenCalledWith("保存していない編集を破棄しますか？");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("何も編集していなければ、✕を押しても確認せずに閉じる", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onClose = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
