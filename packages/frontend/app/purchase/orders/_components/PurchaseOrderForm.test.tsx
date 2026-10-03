import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseOrderForm } from "./PurchaseOrderForm";

function baseProps(overrides: Partial<Parameters<typeof PurchaseOrderForm>[0]> = {}) {
  return {
    editingId: null,
    editingStatus: null,
    title: "",
    setTitle: vi.fn(),
    partnerId: "",
    onSupplierMasterSelect: vi.fn(),
    suppliers: [],
    requestId: null,
    orderDate: "2026-01-01",
    setOrderDate: vi.fn(),
    memo: "",
    setMemo: vi.fn(),
    items: [],
    addItemRow: vi.fn(),
    updateItemRow: vi.fn(),
    onItemTypeChange: vi.fn(),
    onItemMasterSelect: vi.fn(),
    onItemQuantityChange: vi.fn(),
    removeItemRow: vi.fn(),
    moveItemUp: vi.fn(),
    moveItemDown: vi.fn(),
    projectId: "",
    setProjectId: vi.fn(),
    purchasePersonEmployeeNumber: "",
    setPurchasePersonEmployeeNumber: vi.fn(),
    inputPersonEmployeeNumber: "",
    setInputPersonEmployeeNumber: vi.fn(),
    companyName: "",
    setCompanyName: vi.fn(),
    companyDepartment: "",
    setCompanyDepartment: vi.fn(),
    companyAddress: "",
    setCompanyAddress: vi.fn(),
    companyTel: "",
    setCompanyTel: vi.fn(),
    companyFax: "",
    setCompanyFax: vi.fn(),
    deliveryDate: "",
    setDeliveryDate: vi.fn(),
    deliveryPlace: "",
    setDeliveryPlace: vi.fn(),
    deliveryLocationId: "",
    setDeliveryLocationId: vi.fn(),
    deliveryWarehouseId: "",
    setDeliveryWarehouseId: vi.fn(),
    businessLocations: [],
    warehouses: [],
    paymentTerms: "",
    setPaymentTerms: vi.fn(),
    isPaid: false,
    setIsPaid: vi.fn(),
    paidAt: "",
    setPaidAt: vi.fn(),
    userMaster: [],
    units: [],
    taxCategories: [],
    accounts: [],
    attachments: [],
    onAddAttachmentRow: vi.fn(),
    onRemoveAttachmentRow: vi.fn(),
    onFileSelection: vi.fn(),
    onAttachmentFileNameChange: vi.fn(),
    onAttachmentExternalUrlChange: vi.fn(),
    totalAmount: 0,
    taxAmount: 0,
    calcSubTotal: () => 0,
    calcGrossSubTotal: () => 0,
    calcDiscountTotal: () => 0,
    calcTax: () => 0,
    calcTaxBreakdown: () => ({
      rate10: { excl: 0, tax: 0 },
      rate8: { excl: 0, tax: 0 },
      rate0: { excl: 0, tax: 0 },
    }),
    calcTotal: () => 0,
    allItems: [],
    projects: [],
    isPurchaseOrderWfEnabled: false,
    isApprovedEdit: false,
    isLocked: false,
    isSubmitting: false,
    onSubmit: vi.fn(),
    onSubmitForApproval: vi.fn(),
    onGeneratePdf: vi.fn(),
    onOpenMailModal: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

// 新規要望(2026-09-23): 発注の納品場所を「拠点用」「倉庫用」の2つの独立した選択欄から選べる
describe("PurchaseOrderForm: 納品場所(拠点/倉庫)選択", () => {
  it("営業拠点を選択すると、deliveryPlaceへ名称がコピーされ倉庫選択はクリアされる", async () => {
    const user = userEvent.setup();
    const setDeliveryLocationId = vi.fn();
    const setDeliveryWarehouseId = vi.fn();
    const setDeliveryPlace = vi.fn();
    render(
      <PurchaseOrderForm
        {...baseProps({
          businessLocations: [{ id: "BL-1", name: "東京営業所" }],
          deliveryWarehouseId: "WH-1",
          setDeliveryLocationId,
          setDeliveryWarehouseId,
          setDeliveryPlace,
        })}
      />,
    );

    const locationSelect = screen
      .getByText("-- 営業拠点から選択 --")
      .closest("select") as HTMLSelectElement;
    await user.selectOptions(locationSelect, "BL-1");

    expect(setDeliveryLocationId).toHaveBeenCalledWith("BL-1");
    expect(setDeliveryWarehouseId).toHaveBeenCalledWith("");
    expect(setDeliveryPlace).toHaveBeenCalledWith("東京営業所");
  });

  it("倉庫を選択すると、deliveryPlaceへ名称がコピーされ拠点選択はクリアされる", async () => {
    const user = userEvent.setup();
    const setDeliveryLocationId = vi.fn();
    const setDeliveryWarehouseId = vi.fn();
    const setDeliveryPlace = vi.fn();
    render(
      <PurchaseOrderForm
        {...baseProps({
          warehouses: [{ id: "WH-1", name: "本社倉庫" }],
          deliveryLocationId: "BL-1",
          setDeliveryLocationId,
          setDeliveryWarehouseId,
          setDeliveryPlace,
        })}
      />,
    );

    const warehouseSelect = screen
      .getByText("-- 倉庫から選択 --")
      .closest("select") as HTMLSelectElement;
    await user.selectOptions(warehouseSelect, "WH-1");

    expect(setDeliveryWarehouseId).toHaveBeenCalledWith("WH-1");
    expect(setDeliveryLocationId).toHaveBeenCalledWith("");
    expect(setDeliveryPlace).toHaveBeenCalledWith("本社倉庫");
  });

  it("納品場所は手入力もできる(拠点/倉庫を選択していなくても入力欄は使える)", async () => {
    const setDeliveryPlace = vi.fn();
    const user = userEvent.setup();
    render(<PurchaseOrderForm {...baseProps({ setDeliveryPlace })} />);

    await user.type(screen.getByPlaceholderText("下の拠点/倉庫選択、または直接入力"), "A");

    expect(setDeliveryPlace).toHaveBeenCalledWith("A");
  });
});

describe("PurchaseOrderForm: BUG-063 取引停止の仕入先", () => {
  const suppliers = [
    { id: "SUPP-1", name: "仕入先A", status: "active" },
    { id: "SUPP-5", name: "仕入先E(取引停止)", status: "suspended" },
  ];

  it("新規登録では、取引停止の仕入先を選択肢に出さない", () => {
    render(<PurchaseOrderForm {...baseProps({ suppliers, partnerId: "" })} />);

    expect(screen.getByRole("option", { name: "[SUPP-1] 仕入先A" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /SUPP-5/ })).not.toBeInTheDocument();
  });

  it("既に取引停止の仕入先が選ばれている伝票では、その仕入先を表示に残す", () => {
    render(<PurchaseOrderForm {...baseProps({ suppliers, partnerId: "SUPP-5", editingId: "PO-1" })} />);

    expect(screen.getByRole("option", { name: /SUPP-5/ })).toBeInTheDocument();
  });
});
