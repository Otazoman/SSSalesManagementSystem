import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PriceForm } from "./PriceForm";
import { initialPriceFormState } from "../_hooks/usePriceOperations";

function makeForm(overrides: Record<string, unknown> = {}) {
  return {
    formData: initialPriceFormState,
    editingId: null,
    isPriceCurrentlyLocked: false,
    isSubmitting: false,
    items: [{ id: "ITEM-1", name: "品目A", baseUnitCode: "KG" }],
    partners: [{ id: "CUST-1", name: "得意先A" }],
    units: [{ code: "KG", name: "キログラム" }],
    handleInputChange: vi.fn(),
    handleSubmit: vi.fn(async () => true),
    ...overrides,
  };
}

describe("PriceForm", () => {
  it("新規登録時は登録見出しとボタンを表示する", () => {
    render(
      <PriceForm
        form={makeForm() as never}
        canCreate
        canUpdate
        onSubmitSuccess={vi.fn()}
      />,
    );
    expect(screen.getByText("🔏 特値・個別価格の個別登録")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeInTheDocument();
  });

  it("編集時は編集見出しと上書き保存ボタンを表示する", () => {
    render(
      <PriceForm
        form={makeForm({ editingId: "PRICE-1" }) as never}
        canCreate
        canUpdate
        onSubmitSuccess={vi.fn()}
      />,
    );
    expect(screen.getByText("📝 特値・個別価格の編集修正")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("承認ワークフロー有効時の新規登録は申請ボタン文言になる", () => {
    render(
      <PriceForm
        form={makeForm() as never}
        canCreate
        canUpdate
        isProductPriceWfEnabled
        onSubmitSuccess={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "✨ 承認を申請する" }),
    ).toBeInTheDocument();
  });

  it("isPriceCurrentlyLocked:trueの場合はロック警告文を表示しfieldsetを無効化する", () => {
    const { container } = render(
      <PriceForm
        form={
          makeForm({
            editingId: "PRICE-1",
            isPriceCurrentlyLocked: true,
          }) as never
        }
        canCreate
        canUpdate
        onSubmitSuccess={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        /承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます/,
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("fieldset")).toBeDisabled();
  });

  it("canCreate:falseの場合は閲覧専用バッジを表示する", () => {
    render(
      <PriceForm
        form={makeForm() as never}
        canCreate={false}
        canUpdate
        onSubmitSuccess={vi.fn()}
      />,
    );
    expect(screen.getByText("閲覧専用(操作権限なし)")).toBeInTheDocument();
  });

  it("送信成功時はonSubmitSuccessを呼ぶ", async () => {
    const onSubmitSuccess = vi.fn();
    const form = makeForm({
      formData: { ...initialPriceFormState, itemId: "ITEM-1" },
    });
    render(
      <PriceForm
        form={form as never}
        canCreate
        canUpdate
        onSubmitSuccess={onSubmitSuccess}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "登録" }));

    expect(form.handleSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmitSuccess).toHaveBeenCalledTimes(1);
  });

  it("送信失敗(false)時はonSubmitSuccessを呼ばない", async () => {
    const onSubmitSuccess = vi.fn();
    const form = makeForm({
      formData: { ...initialPriceFormState, itemId: "ITEM-1" },
      handleSubmit: vi.fn(async () => false),
    });
    render(
      <PriceForm
        form={form as never}
        canCreate
        canUpdate
        onSubmitSuccess={onSubmitSuccess}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "登録" }));

    expect(onSubmitSuccess).not.toHaveBeenCalled();
  });
});
