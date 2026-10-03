import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaxCategoryForm } from "./TaxCategoryForm";

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseProps() {
  return {
    initialData: null,
    canCreate: true,
    canUpdate: true,
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onClear: vi.fn(),
  };
}

describe("TaxCategoryForm", () => {
  it("新規登録時は「新規消費税区分の追加」の見出しを表示し取消ボタンは無い", () => {
    render(<TaxCategoryForm {...baseProps()} />);
    expect(screen.getByText("新規消費税区分の追加")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
  });

  it("編集時は既存値を表示しコードを無効化、取消ボタンを表示する", () => {
    render(
      <TaxCategoryForm
        {...baseProps()}
        initialData={{ code: "TAX_10", name: "10%標準税率", taxType: "STANDARD", taxRate: 0.1, validFrom: null, validTo: null }}
      />,
    );
    expect(screen.getByText("消費税区分の編集")).toBeInTheDocument();
    expect(screen.getByDisplayValue("TAX_10")).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("taxType:EXEMPT選択時は税率入力を無効化し0にする", async () => {
    render(<TaxCategoryForm {...baseProps()} />);
    const select = screen.getByDisplayValue("標準/指定税率 (STANDARD)");
    await userEvent.selectOptions(select, "EXEMPT");

    const rateInput = screen.getByPlaceholderText("0.10") as HTMLInputElement;
    expect(rateInput).toBeDisabled();
    expect(rateInput.value).toBe("0");
  });

  it("canCreate:falseの場合は閲覧専用表示になり保存ボタンが無効になる", () => {
    render(<TaxCategoryForm {...baseProps()} canCreate={false} />);
    expect(screen.getByText("閲覧専用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();
  });

  it("取消ボタンクリックでonClearを呼ぶ", async () => {
    const props = baseProps();
    render(
      <TaxCategoryForm
        {...props}
        initialData={{ code: "TAX_10", name: "税", taxType: "STANDARD", taxRate: 0.1, validFrom: null, validTo: null }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it("フォーム送信でapiFetchが呼ばれonSuccessに至る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })),
    );
    const props = baseProps();
    render(<TaxCategoryForm {...props} />);

    await userEvent.type(screen.getByPlaceholderText("例: TAX_10"), "TAX_08");
    await userEvent.type(screen.getByPlaceholderText("例: 10%標準税率"), "軽減税率8%");
    await userEvent.click(screen.getByRole("button", { name: "保存する" }));

    expect(props.onSuccess).toHaveBeenCalledWith("消費税区分を保存しました");
  });
});
