import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PartnerTable from "./PartnerTable";
import { PartnerRecord } from "../_types";

const partners: PartnerRecord[] = [
  {
    id: "CUST-001",
    name: "株式会社テスト",
    type: "CUSTOMER",
    postalCode: "100-0001",
    address: "東京都千代田区",
    creditLimit: 1000000,
    status: "active",
    memo: null,
    closingDay: 20,
    paymentMonthOffset: 1,
    paymentDay: 99,
  },
  {
    id: "CUST-002",
    name: "廃止取引先",
    type: "SUPPLIER",
    postalCode: null,
    address: null,
    creditLimit: 0,
    status: "suspended",
    memo: null,
    closingDay: null,
    paymentMonthOffset: null,
    paymentDay: null,
  },
];

function setup(overrides: Partial<Parameters<typeof PartnerTable>[0]> = {}) {
  const onSelectRow = vi.fn();
  const onSuspend = vi.fn();
  const onPurge = vi.fn();
  render(
    <PartnerTable
      partners={partners}
      canUpdate
      canDelete
      isSubmitting={false}
      onSelectRow={onSelectRow}
      onSuspend={onSuspend}
      onPurge={onPurge}
      {...overrides}
    />,
  );
  return { onSelectRow, onSuspend, onPurge };
}

describe("PartnerTable", () => {
  it("取引先コード・名称を表示する", () => {
    setup();
    expect(screen.getByText("CUST-001")).toBeInTheDocument();
    expect(screen.getByText("株式会社テスト")).toBeInTheDocument();
  });

  it("suspendedの行は「完全に削除」ボタンを、それ以外は「無効化」ボタンを表示する", () => {
    setup();
    expect(screen.getByRole("button", { name: "完全に削除 🗑️" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効化" })).toBeInTheDocument();
  });

  it("行クリックでonSelectRowを呼ぶ", async () => {
    const { onSelectRow } = setup();
    await userEvent.click(screen.getByText("株式会社テスト"));
    expect(onSelectRow).toHaveBeenCalledWith(partners[0]);
  });

  it("「無効化」クリックはonSuspendのみ呼び行選択には伝播しない", async () => {
    const { onSelectRow, onSuspend } = setup();
    await userEvent.click(screen.getByRole("button", { name: "無効化" }));
    expect(onSuspend).toHaveBeenCalledWith("CUST-001", "株式会社テスト");
    expect(onSelectRow).not.toHaveBeenCalled();
  });

  it("「完全に削除」クリックでonPurgeを呼ぶ", async () => {
    const { onPurge } = setup();
    await userEvent.click(screen.getByRole("button", { name: "完全に削除 🗑️" }));
    expect(onPurge).toHaveBeenCalledWith("CUST-002", "廃止取引先");
  });

  it("空データの場合は空メッセージを表示する", () => {
    setup({ partners: [] });
    expect(
      screen.getByText("該当するデータはありません"),
    ).toBeInTheDocument();
  });
});
