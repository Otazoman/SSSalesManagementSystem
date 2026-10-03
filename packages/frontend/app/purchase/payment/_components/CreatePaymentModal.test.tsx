import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreatePaymentModal } from "./CreatePaymentModal";
import type { ComponentProps } from "react";

type ModalProps = ComponentProps<typeof CreatePaymentModal>;

const baseForm = {
  partnerId: "P-1",
  mode: "PERIODIC" as const,
  paymentDate: "2026-09-21",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  title: "",
  memo: "",
  purchaseRecognitionIds: [] as string[],
  itemReceiptSelections: [] as ModalProps["createForm"]["itemReceiptSelections"],
  manualItems: [] as ModalProps["createForm"]["manualItems"],
};

const recognition = {
  id: "SR-1",
  title: null,
  partnerId: "P-1",
  recognitionDate: "2026-09-10T00:00:00.000Z",
  totalAmount: 11000,
  taxAmount: 1000,
  isAdvancePrepaid: false,
  advanceOrderId: null,
  advancePaidAt: null,
};

const receipt = {
  id: "RCPT-1",
  partnerId: "P-1",
  receivedDate: "2026-09-09T00:00:00.000Z",
  supplierInvoiceNumber: null,
  computedAmount: 11000,
  computedTaxAmount: 1000,
  requiresManualAmount: false,
};

function renderModal(overrides: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    isOpen: true,
    partners: [{ id: "P-1", name: "仕入先1" }],
    createForm: baseForm,
    setCreateForm: vi.fn(),
    candidateRecognitions: [recognition],
    candidateItemReceipts: [receipt],
    onPartnerChange: vi.fn(),
    onToggleRecognition: vi.fn(),
    onToggleItemReceipt: vi.fn(),
    onItemReceiptAmountChange: vi.fn(),
    onAddManualItem: vi.fn(),
    onRemoveManualItem: vi.fn(),
    onManualItemChange: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return render(<CreatePaymentModal {...props} />);
}

describe("CreatePaymentModal: L-1-b 二重支払の警告", () => {
  it("紐づく検収が支払対象済みの仕入には警告バッジを表示する", () => {
    renderModal({
      candidateRecognitions: [{ ...recognition, linkedReceiptIds: ["RCPT-1"], linkedReceiptPaid: true }],
    });

    expect(screen.getByText("⚠ 同じ納品の検収が支払対象済み")).toBeInTheDocument();
  });

  it("警告のない仕入にはバッジを表示しない", () => {
    renderModal();

    expect(screen.queryByText(/同じ納品の検収が支払対象済み/)).not.toBeInTheDocument();
  });

  it("紐づく仕入が支払済みの検収には警告バッジを表示する(検収タブ)", () => {
    renderModal({
      candidateItemReceipts: [{ ...receipt, linkedRecognitionIds: ["SR-9"], linkedRecognitionPaid: true }],
    });
    fireEvent.click(screen.getByText("📦 検収から選択"));

    expect(screen.getByText("⚠ 同じ納品の仕入が支払済み")).toBeInTheDocument();
  });

  it("紐づく仕入と検収を同じ支払に両方選ぶと、警告バナーを表示する", () => {
    renderModal({
      candidateRecognitions: [{ ...recognition, linkedReceiptIds: ["RCPT-1"], linkedReceiptPaid: false }],
      createForm: {
        ...baseForm,
        purchaseRecognitionIds: ["SR-1"],
        itemReceiptSelections: [{ id: "RCPT-1", amount: "11000", taxAmount: "1000", requiresManualAmount: false }],
      },
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("二重支払の可能性");
    expect(alert).toHaveTextContent("仕入[SR-1] と 検収[RCPT-1]");
  });

  it("片方だけ選んでいる場合はバナーを表示しない", () => {
    renderModal({
      candidateRecognitions: [{ ...recognition, linkedReceiptIds: ["RCPT-1"], linkedReceiptPaid: false }],
      createForm: { ...baseForm, purchaseRecognitionIds: ["SR-1"] },
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
