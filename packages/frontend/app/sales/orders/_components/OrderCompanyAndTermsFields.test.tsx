import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderCompanyAndTermsFields } from "./OrderCompanyAndTermsFields";

function baseProps(overrides: Partial<Parameters<typeof OrderCompanyAndTermsFields>[0]> = {}) {
  return {
    companyName: "",
    setCompanyName: vi.fn(),
    companyZip: "",
    setCompanyZip: vi.fn(),
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
    deliveryDestinationId: "",
    setDeliveryDestinationId: vi.fn(),
    deliveryDestinations: [],
    paymentTerms: "",
    setPaymentTerms: vi.fn(),
    ...overrides,
  };
}

// 新規要望(2026-09-23): 受注の納品場所を取引先の納品先一覧から選べる
describe("OrderCompanyAndTermsFields: 納品場所(取引先の納品先)選択", () => {
  it("納品先を選択すると、deliveryPlaceへ名称がコピーされる", async () => {
    const user = userEvent.setup();
    const setDeliveryDestinationId = vi.fn();
    const setDeliveryPlace = vi.fn();
    render(
      <OrderCompanyAndTermsFields
        {...baseProps({
          deliveryDestinations: [{ id: "DD-1", partnerId: "P-1", name: "東京支店" }],
          setDeliveryDestinationId,
          setDeliveryPlace,
        })}
      />,
    );

    const select = screen
      .getByText("-- 納品先から選択 --")
      .closest("select") as HTMLSelectElement;
    await user.selectOptions(select, "DD-1");

    expect(setDeliveryDestinationId).toHaveBeenCalledWith("DD-1");
    expect(setDeliveryPlace).toHaveBeenCalledWith("東京支店");
  });

  it("納品場所は手入力もできる", async () => {
    const setDeliveryPlace = vi.fn();
    const user = userEvent.setup();
    render(<OrderCompanyAndTermsFields {...baseProps({ setDeliveryPlace })} />);

    await user.type(screen.getByPlaceholderText("下の納品先選択、または直接入力"), "A");

    expect(setDeliveryPlace).toHaveBeenCalledWith("A");
  });
});
