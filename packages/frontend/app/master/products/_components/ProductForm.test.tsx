import { describe, it, expect, vi, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductForm } from "./ProductForm";

type ProductFormProps = ComponentProps<typeof ProductForm>;

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    editingId: null,
    onClear: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    accounts: [{ code: "ACC-1", name: "売上高" }],
    units: [{ code: "PCS", name: "個" }],
    suppliers: [{ id: "SUP-1", name: "仕入先A" }],
    taxCategories: [
      {
        code: "TAX_10",
        name: "10%課税",
        taxType: "STANDARD" as const,
        taxRate: 0.1,
      },
    ],
    canCreate: true,
    canUpdate: true,
    initialData: null,
    ...overrides,
  };
}

describe("ProductForm", () => {
  it("新規登録時は見出しと登録ボタンを表示する", () => {
    render(<ProductForm {...(baseProps() as ProductFormProps)} />);
    expect(screen.getByText("新規個別品目登録")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeInTheDocument();
  });

  it("編集時は見出しと直接保存ボタンを表示する", () => {
    render(
      <ProductForm
        {...(baseProps({
          editingId: "ITEM-1",
          initialData: {
            id: "ITEM-1",
            name: "品目A",
            isPurchased: false,
            isSales: true,
            isService: false,
            baseUnitCode: "PCS",
            taxCategoryCode: "TAX_10",
            productBarcode: null,
            accountCode: "ACC-1",
            memo: null,
            status: "active",
            supplierId: null,
            supplierPartNumber: null,
          },
        }) as ProductFormProps)}
      />,
    );
    expect(screen.getByText("品目マスタ情報の編集")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("承認ワークフロー有効時の新規登録は申請ボタン文言になる", () => {
    render(
      <ProductForm
        {...(baseProps({ isProductWfEnabled: true }) as ProductFormProps)}
      />,
    );
    expect(
      screen.getByRole("button", { name: "✨ 承認を申請する" }),
    ).toBeInTheDocument();
  });

  it("品目ID入力ができる", async () => {
    render(<ProductForm {...(baseProps() as ProductFormProps)} />);
    const input = screen.getByPlaceholderText(
      "例: ITEM-001(空欄で自動採番)",
    ) as HTMLInputElement;
    await userEvent.type(input, "ITEM-9");
    expect(input.value).toBe("ITEM-9");
  });

  it("フォーム送信でapi登録エンドポイントを叩く(required項目を満たした状態)", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    render(<ProductForm {...(baseProps({ onSuccess }) as ProductFormProps)} />);

    await userEvent.type(
      screen.getByPlaceholderText("例: ITEM-001(空欄で自動採番)"),
      "ITEM-9",
    );
    await userEvent.type(screen.getByPlaceholderText("品物名・規格"), "新品目");

    await userEvent.click(screen.getByRole("button", { name: "登録" }));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/products/register",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
