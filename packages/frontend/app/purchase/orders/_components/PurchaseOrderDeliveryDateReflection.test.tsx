import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PurchaseOrderDeliveryDateReflection } from "./PurchaseOrderDeliveryDateReflection";

// 新規要望(2026-10-18): 回答納期の受注への反映方法と「納期のみ保存」の操作欄
function renderPanel(overrides: Partial<Parameters<typeof PurchaseOrderDeliveryDateReflection>[0]> = {}) {
  const props = {
    value: { mode: "NONE" as const, addDays: 0 },
    onChange: vi.fn(),
    hasLinkedItems: true,
    canSaveDeliveryDatesOnly: true,
    isLocked: false,
    isSubmitting: false,
    onSaveDeliveryDatesOnly: vi.fn(),
    ...overrides,
  };
  render(<PurchaseOrderDeliveryDateReflection {...props} />);
  return props;
}

describe("PurchaseOrderDeliveryDateReflection", () => {
  it("受注に紐づく明細も保存済みの承認発注も無ければ何も表示しない", () => {
    const { container } = render(
      <PurchaseOrderDeliveryDateReflection
        value={{ mode: "NONE", addDays: 0 }}
        onChange={vi.fn()}
        hasLinkedItems={false}
        canSaveDeliveryDatesOnly={false}
        isLocked={false}
        isSubmitting={false}
        onSaveDeliveryDatesOnly={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("反映方法を選ぶとonChangeが呼ばれる", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByLabelText("回答納期をそのまま反映"));
    expect(props.onChange).toHaveBeenCalledWith({ mode: "SAME", addDays: 0 });
  });

  it("日数はN日加算を選んだときだけ入力でき、0〜365の整数に丸める", () => {
    const props = renderPanel({ value: { mode: "ADD_DAYS", addDays: 3 } });
    const input = screen.getByLabelText("回答納期に加算する日数") as HTMLInputElement;
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { value: "999" } });
    expect(props.onChange).toHaveBeenCalledWith({ mode: "ADD_DAYS", addDays: 365 });
  });

  it("「納期のみ保存」を押すとonSaveDeliveryDatesOnlyが呼ばれる", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /納期のみ保存/ }));
    expect(props.onSaveDeliveryDatesOnly).toHaveBeenCalledTimes(1);
  });

  it("承認処理中(isLocked)は「納期のみ保存」を押せない", () => {
    renderPanel({ isLocked: true });
    expect(screen.getByRole("button", { name: /納期のみ保存/ })).toBeDisabled();
  });
});
