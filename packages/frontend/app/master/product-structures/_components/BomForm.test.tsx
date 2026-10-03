import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BomForm } from "./BomForm";
import { ItemLookup } from "../_types";

type BomFormProps = ComponentProps<typeof BomForm>;

const allItems: ItemLookup[] = [
  { id: "TOP", name: "完成品A", status: "active" },
  { id: "CHILD", name: "部品B", status: "active" },
];

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    editingId: null,
    parentItemId: "",
    setParentItemId: vi.fn(),
    childItemId: "",
    setChildItemId: vi.fn(),
    quantityRequired: 1,
    setQuantityRequired: vi.fn(),
    revision: "1.0",
    setRevision: vi.fn(),
    validFrom: "",
    setValidFrom: vi.fn(),
    validTo: "",
    setValidTo: vi.fn(),
    memo: "",
    setMemo: vi.fn(),
    status: "active",
    setStatus: vi.fn(),
    allItems,
    canCreate: true,
    canUpdate: true,
    onSubmit: vi.fn((e: React.SyntheticEvent) => e.preventDefault()),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("BomForm", () => {
  it("新規登録時は見出しと登録ボタンを表示する", () => {
    render(<BomForm {...(baseProps() as BomFormProps)} />);
    expect(screen.getByText("新規品目構成(BOM)の登録")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeInTheDocument();
  });

  it("編集時は見出しと直接保存ボタン、キャンセルボタンを表示する", () => {
    render(
      <BomForm {...(baseProps({ editingId: "STR-1" }) as BomFormProps)} />,
    );
    expect(screen.getByText("品目構成リビジョンの編集")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "キャンセル" }),
    ).toBeInTheDocument();
  });

  it("承認ワークフロー有効時の新規登録は申請ボタン文言になる", () => {
    render(
      <BomForm
        {...(baseProps({ isItemStructureWfEnabled: true }) as BomFormProps)}
      />,
    );
    expect(
      screen.getByRole("button", { name: "✨ 承認を申請する" }),
    ).toBeInTheDocument();
  });

  it("isStructureCurrentlyLocked:trueの場合はロック警告文を表示しfieldsetを無効化する", () => {
    const { container } = render(
      <BomForm
        {...(baseProps({
          editingId: "STR-1",
          isStructureCurrentlyLocked: true,
        }) as BomFormProps)}
      />,
    );
    expect(
      screen.getByText(
        /承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます/,
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("fieldset")).toBeDisabled();
  });

  it("編集時は親品目・子部品・リビジョンのセレクト/入力が無効化される", () => {
    render(
      <BomForm {...(baseProps({ editingId: "STR-1" }) as BomFormProps)} />,
    );
    expect(screen.getByPlaceholderText("例: 1.0")).toBeDisabled();
  });

  it("canCreate:falseの場合は閲覧専用バッジを表示する", () => {
    render(<BomForm {...(baseProps({ canCreate: false }) as BomFormProps)} />);
    expect(screen.getByText("閲覧専用")).toBeInTheDocument();
  });

  it("キャンセルクリックでonCancelを呼ぶ", async () => {
    const props = baseProps({ editingId: "STR-1" });
    render(<BomForm {...(props as BomFormProps)} />);
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("フォーム送信でonSubmitが呼ばれる(required項目を満たした状態)", async () => {
    const props = baseProps({
      parentItemId: "TOP",
      childItemId: "CHILD",
      validFrom: "2026-01-01",
    });
    render(<BomForm {...(props as BomFormProps)} />);
    await userEvent.click(screen.getByRole("button", { name: "登録" }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
});
