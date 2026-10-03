import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BillingDetailModal } from "./BillingDetailModal";
import { BillingDetail } from "../_types";

// BUG-045: 確認(useConfirm)は結果を Promise で返すため、クリックの後に確認の結果を待つ
const flush = () => act(async () => {});

const DETAIL: BillingDetail = {
  id: "BL-1",
  partnerId: "P-1",
  title: "テスト請求",
  billingDate: "2026-09-01T00:00:00.000Z",
  mode: "PER_TRANSACTION",
  status: "DRAFT",
  totalAmount: 11000,
  taxAmount: 1000,
  reconciledAmount: 0,
  reconciliationStatus: "UNRECONCILED",
  memo: null,
  items: [],
  paymentReceipts: [],
};

function renderModal(onClose = vi.fn()) {
  render(
    <BillingDetailModal
      detail={DETAIL}
      onClose={onClose}
      onGeneratePDF={vi.fn()}
      onRecordPaymentReceipt={vi.fn(async () => true)}
      showMailModal={false}
      setShowMailModal={vi.fn()}
      recipientEmail=""
      setRecipientEmail={vi.fn()}
      partnerContacts={[]}
      selectedContactId=""
      onContactSelect={vi.fn()}
      onSendEmail={vi.fn()}
      isMailSending={false}
    />,
  );
  return onClose;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BillingDetailModal(編集キャンセル時の確認)", () => {
  it("入金消込欄を編集後に✕を押すと確認し、続けるを選ぶと閉じない", async () => {
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
