import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SecuritySettings } from "./SecuritySettings";
import { SystemSettings } from "../_types";

function baseSettings(): SystemSettings {
  return {
    is_audit_log_enabled: true,
    is_partner_approval_enabled: false,
    is_partner_contact_approval_enabled: false,
    is_product_approval_enabled: false,
    is_product_price_approval_enabled: false,
    is_item_structure_approval_enabled: false,
    is_unit_approval_enabled: false,
    is_account_approval_enabled: false,
    is_warehouse_approval_enabled: false,
    is_location_approval_enabled: false,
    is_quote_approval_enabled: false,
    is_sales_order_approval_enabled: false,
    is_purchase_order_approval_enabled: false,
    is_sales_approval_enabled: false,
    is_purchase_approval_enabled: false,
    is_receiving_approval_enabled: false,
    is_shipping_approval_enabled: false,
    is_inventory_approval_enabled: false,
    is_shipping_instruction_approval_enabled: false,
    is_shipping_result_approval_enabled: false,
    is_receiving_instruction_approval_enabled: false,
    is_receiving_result_approval_enabled: false,
    is_disposal_approval_enabled: false,
    is_damage_approval_enabled: false,
    is_return_approval_enabled: false,
    is_pagination_enabled: false,
    login_max_failed_attempts: "5",
  } as SystemSettings;
}

describe("SecuritySettings", () => {
  it("ログインの失敗回数の上限を表示し、入力するとsetSettingsを呼ぶ(BUG-022)", async () => {
    const setSettings = vi.fn();
    render(
      <SecuritySettings settings={baseSettings()} setSettings={setSettings} canWrite />,
    );
    const input = screen.getByLabelText("ログインの失敗回数の上限(回)");
    expect(input).toHaveValue(5);
    await userEvent.type(input, "0");
    expect(setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ login_max_failed_attempts: "50" }),
    );
  });

  it("canWrite:falseの場合は、ログインの失敗回数の上限も入力できない", () => {
    render(
      <SecuritySettings settings={baseSettings()} setSettings={vi.fn()} canWrite={false} />,
    );
    expect(screen.getByLabelText("ログインの失敗回数の上限(回)")).toBeDisabled();
  });

  it("パスワードの最小文字数・含める文字を設定できる(BUG-046)", async () => {
    const setSettings = vi.fn();
    render(
      <SecuritySettings settings={baseSettings()} setSettings={setSettings} canWrite />,
    );
    const input = screen.getByLabelText("パスワードの最小文字数(文字)");
    expect(input).toHaveValue(8);
    await userEvent.type(input, "0");
    expect(setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ password_min_length: "80" }),
    );
    await userEvent.click(screen.getByLabelText("記号"));
    expect(setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ password_require_symbol: true }),
    );
  });

  it("is_pagination_enabledの初期値をチェックボックスへ反映する", () => {
    render(
      <SecuritySettings settings={baseSettings()} setSettings={vi.fn()} canWrite />,
    );
    expect(screen.getByLabelText("一覧画面のページネーションを有効化する")).not.toBeChecked();
  });

  it("ページネーショントグルのクリックでsetSettingsを呼びis_pagination_enabledを反転する", async () => {
    const setSettings = vi.fn();
    render(
      <SecuritySettings settings={baseSettings()} setSettings={setSettings} canWrite />,
    );
    await userEvent.click(
      screen.getByLabelText("一覧画面のページネーションを有効化する"),
    );
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ is_pagination_enabled: true }),
    );
  });

  it("canWrite:falseの場合はすべてのチェックボックスが無効になる", () => {
    render(
      <SecuritySettings settings={baseSettings()} setSettings={vi.fn()} canWrite={false} />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((cb) => expect(cb).toBeDisabled());
  });

  it("マスタ承認トグル(単位)クリックでsetSettingsを呼ぶ", async () => {
    const setSettings = vi.fn();
    render(
      <SecuritySettings settings={baseSettings()} setSettings={setSettings} canWrite />,
    );
    await userEvent.click(screen.getByLabelText("単位"));
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ is_unit_approval_enabled: true }),
    );
  });
});
