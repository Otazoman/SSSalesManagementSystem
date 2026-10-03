import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountTable } from "./AccountTable";
import { AccountRecord } from "../_types";

const accounts: AccountRecord[] = [
  { code: "1111", name: "現金", externalMappingCode: "OB_1111", status: "active", memo: "メモ1" },
  { code: "2222", name: "仮登録科目", externalMappingCode: null, status: "temporary", memo: null },
  { code: "3333", name: "廃止科目", externalMappingCode: null, status: "suspended", memo: null },
];

function setup(overrides: Partial<Parameters<typeof AccountTable>[0]> = {}) {
  const onSelectAccount = vi.fn();
  const onDelete = vi.fn();
  const onSuspend = vi.fn();
  render(
    <AccountTable
      accounts={accounts}
      onSelectAccount={onSelectAccount}
      onDelete={onDelete}
      onSuspend={onSuspend}
      canUpdate
      canDelete
      {...overrides}
    />,
  );
  return { onSelectAccount, onDelete, onSuspend };
}

describe("AccountTable", () => {
  it("科目コード・名称・外部連携コードを表示する", () => {
    setup();
    expect(screen.getByText("1111")).toBeInTheDocument();
    expect(screen.getByText("現金")).toBeInTheDocument();
    expect(screen.getByText("OB_1111")).toBeInTheDocument();
  });

  it("外部連携コード未設定の場合は「未割当」を表示する", () => {
    setup();
    expect(screen.getAllByText("未割当").length).toBeGreaterThan(0);
  });

  it("statusごとのバッジラベルを表示する", () => {
    setup();
    expect(screen.getByText("有効")).toBeInTheDocument();
    expect(screen.getByText("仮登録/申請中")).toBeInTheDocument();
    expect(screen.getByText("無効")).toBeInTheDocument();
  });

  it("suspended以外は無効化ボタン、suspendedは削除ボタンを表示する", () => {
    setup();
    expect(screen.getAllByRole("button", { name: "無効化" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
  });

  it("行クリックでonSelectAccountを呼ぶ", async () => {
    const { onSelectAccount } = setup();
    await userEvent.click(screen.getByText("現金"));
    expect(onSelectAccount).toHaveBeenCalledWith(accounts[0]);
  });

  it("無効化ボタンはonSuspendのみ呼び行クリックへ伝播しない", async () => {
    const { onSelectAccount, onSuspend } = setup();
    await userEvent.click(screen.getAllByRole("button", { name: "無効化" })[0]);
    expect(onSuspend).toHaveBeenCalledWith(accounts[0]);
    expect(onSelectAccount).not.toHaveBeenCalled();
  });

  it("削除ボタンはonDeleteを呼ぶ", async () => {
    const { onDelete } = setup();
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onDelete).toHaveBeenCalledWith(accounts[2]);
  });

  it("canDelete:falseの場合は無効化ボタンが無効になる", () => {
    setup({ canDelete: false });
    screen.getAllByRole("button", { name: "無効化" }).forEach((btn) => expect(btn).toBeDisabled());
  });

  it("空データの場合は空メッセージを表示する", () => {
    setup({ accounts: [] });
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });
});
