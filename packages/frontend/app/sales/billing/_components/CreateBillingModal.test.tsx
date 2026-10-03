import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CreateBillingModal } from "./CreateBillingModal";
import type { ComponentProps } from "react";

type ModalProps = ComponentProps<typeof CreateBillingModal>;

const baseForm: ModalProps["createForm"] = {
  partnerId: "P-1",
  mode: "PERIODIC",
  billingDate: "2026-09-30",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  title: "",
  memo: "",
  salesInvoiceIds: [],
  manualItems: [],
};

const invoice = {
  id: "SI-1",
  title: null,
  partnerId: "P-1",
  invoiceDate: "2026-09-10T00:00:00.000Z",
  status: "APPROVED",
  billingStatus: "UNBILLED",
  totalAmount: 33000,
  taxAmount: 3000,
};

function renderModal(overrides: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    isOpen: true,
    partners: [{ id: "P-1", name: "得意先1" }],
    taxCategories: [],
    createForm: baseForm,
    setCreateForm: vi.fn(),
    candidateInvoices: [invoice],
    onPartnerChange: vi.fn(),
    onToggleInvoice: vi.fn(),
    onAddManualItem: vi.fn(),
    onRemoveManualItem: vi.fn(),
    onManualItemChange: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return render(<CreateBillingModal {...props} />);
}

describe("CreateBillingModal: BUG-057 赤伝(返品・値引など)の表示と選択合計", () => {
  it("赤伝は△付きで表示し、選択合計から差し引く", () => {
    renderModal({
      createForm: { ...baseForm, salesInvoiceIds: ["SI-1", "SI-RED"] },
      candidateInvoices: [invoice, { ...invoice, id: "SI-RED", totalAmount: 3300, documentType: "DISCOUNT" }],
    });

    expect(screen.getByText("△¥3,300")).toBeInTheDocument();
    expect(screen.getByText("¥29,700")).toBeInTheDocument();
  });
});
