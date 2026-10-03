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

describe("BillingDetailModal: BUG-051 未発行の請求・請求額を超える入金", () => {
  function renderWith(detail: BillingDetail, onRecord = vi.fn(async () => true)) {
    render(
      <BillingDetailModal
        detail={detail}
        onClose={vi.fn()}
        onGeneratePDF={vi.fn()}
        onRecordPaymentReceipt={onRecord}
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
    return onRecord;
  }

  it("未発行(下書き)の請求では、発行が必要なことを表示し、入金を記録できない", () => {
    renderWith(DETAIL);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5000" } });

    expect(screen.getByText(/請求書を発行してから入金を記録できます/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "入金を記録する" })).toBeDisabled();
  });

  it("未消込額を超える入金は、超えた分を前受金として登録することを確認し、キャンセルなら記録しない", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onRecord = renderWith({ ...DETAIL, status: "ISSUED", reconciledAmount: 1000 });

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "15000" } });
    fireEvent.click(screen.getByRole("button", { name: "入金を記録する" }));
    await flush();

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("¥5,000 は前受金"));
    expect(onRecord).not.toHaveBeenCalled();
  });

  it("確認で続けると、入力した金額のまま記録する(超過分の前受金はサーバー側で登録する)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRecord = renderWith({ ...DETAIL, status: "ISSUED" });

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "入金を記録する" }));
    await flush();

    expect(onRecord).toHaveBeenCalledWith("BL-1", expect.objectContaining({ amount: 12000 }));
  });

  it("未消込額以内の入金は、確認を出さずに記録する", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onRecord = renderWith({ ...DETAIL, status: "ISSUED" });

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "11000" } });
    fireEvent.click(screen.getByRole("button", { name: "入金を記録する" }));
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onRecord).toHaveBeenCalledTimes(1);
  });
});
