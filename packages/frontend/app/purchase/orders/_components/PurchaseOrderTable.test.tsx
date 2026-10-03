import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PurchaseOrderTable } from "./PurchaseOrderTable";
import { PurchaseOrderRecord } from "../_types";

function order(overrides: Partial<PurchaseOrderRecord> = {}): PurchaseOrderRecord {
  return {
    id: "PO-1",
    title: "テスト発注",
    partnerId: "PARTNER-1",
    orderDate: "2026-08-01",
    status: "DRAFT",
    totalAmount: 1000,
    memo: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<Parameters<typeof PurchaseOrderTable>[0]> = {}) {
  return {
    orders: [order()],
    partners: [],
    selectedOrderIds: [],
    onSelectToggle: vi.fn(),
    canUpdate: true,
    canDelete: true,
    isSubmitting: false,
    onSelectEdit: vi.fn(),
    onDeleteLink: vi.fn(),
    ...overrides,
  };
}

// メール一括送信は承認済(APPROVED)の発注書PDFにのみ意味があるため、それ以外のステータスを
// チェックボックスで選択できてしまうと、選択件数は増えるのに実際は0件送信され無言で終わる
// (backend側はAPPROVED以外をfindApprovedOrdersByIdsで除外するため実害はないが、UI上の不整合)。
// 見積(QuoteTable)・受注(OrderTable)と同じ「APPROVED以外は選択チェックボックスを無効化する」
// ガードを発注にも適用したことを確認する
describe("PurchaseOrderTable: メール送信対象の選択チェックボックス", () => {
  it("DRAFT行のチェックボックスは無効化されている", () => {
    render(<PurchaseOrderTable {...baseProps({ orders: [order({ status: "DRAFT" })] })} />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("PENDING_APPROVAL行のチェックボックスは無効化されている", () => {
    render(<PurchaseOrderTable {...baseProps({ orders: [order({ status: "PENDING_APPROVAL" })] })} />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("APPROVED行のチェックボックスは選択できる", () => {
    render(<PurchaseOrderTable {...baseProps({ orders: [order({ status: "APPROVED" })] })} />);
    expect(screen.getByRole("checkbox")).not.toBeDisabled();
  });
});
