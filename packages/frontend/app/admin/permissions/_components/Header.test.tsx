import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "./Header";

function baseProps(overrides: Partial<Parameters<typeof Header>[0]> = {}) {
  return {
    screenOptions: [{ resource: "master_units", name: "単位マスタ", category: "master" }],
    permissions: [
      { id: "master_units:read", resource: "master_units", action: "read", name: "", description: null },
    ],
    roles: [{ id: "general_user", name: "一般ユーザー" }],
    selectedRoleId: "general_user",
    checkedPermissionIds: ["master_units:read"],
    canDownload: true,
    isSubmitting: false,
    onDownloadCsv: vi.fn(),
    ...overrides,
  };
}

describe("Header(permissions)", () => {
  it("画面数・権限総数・ロール数・選択中ロール付与数を表示する", () => {
    render(<Header {...baseProps()} />);
    expect(screen.getByText(/対象画面数/)).toBeInTheDocument();
    expect(screen.getByText(/選択中ロール付与数/)).toBeInTheDocument();
  });

  it("selectedRoleId未指定の場合は選択中ロール付与数を表示しない", () => {
    render(<Header {...baseProps({ selectedRoleId: "" })} />);
    expect(screen.queryByText(/選択中ロール付与数/)).not.toBeInTheDocument();
  });

  it("CSVダウンロードボタンクリックでonDownloadCsvを呼ぶ", async () => {
    const onDownloadCsv = vi.fn();
    render(<Header {...baseProps({ onDownloadCsv })} />);
    await userEvent.click(screen.getByRole("button", { name: /CSVダウンロード/ }));
    expect(onDownloadCsv).toHaveBeenCalledTimes(1);
  });

  it("canDownload:falseの場合はCSVダウンロードボタンが無効化される", () => {
    render(<Header {...baseProps({ canDownload: false })} />);
    expect(screen.getByRole("button", { name: /CSVダウンロード/ })).toBeDisabled();
  });

  it("isSubmitting:trueの場合もCSVダウンロードボタンが無効化される", () => {
    render(<Header {...baseProps({ isSubmitting: true })} />);
    expect(screen.getByRole("button", { name: /CSVダウンロード/ })).toBeDisabled();
  });
});
