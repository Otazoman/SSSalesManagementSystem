import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseOrderTable } from "./PurchaseOrderTable";
import { PurchaseOrderPreview } from "./PurchaseOrderPreview";
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

// 新規要望(2026-10-19): 一覧の「複写」ボタン
describe("PurchaseOrderTable: 複写ボタン", () => {
  it("押すとその行の発注で onCopy が呼ばれる", () => {
    const onCopy = vi.fn();
    render(<PurchaseOrderTable {...baseProps({ onCopy, canCopy: true })} />);
    screen.getByRole("button", { name: "複写" }).click();
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: "PO-1" }));
  });

  it("複写できない場合(承認機能が有効など)は押せない", () => {
    render(<PurchaseOrderTable {...baseProps({ onCopy: vi.fn(), canCopy: false })} />);
    expect(screen.getByRole("button", { name: "複写" })).toBeDisabled();
  });
});

describe("PurchaseOrderTable: BUG-095 発注日・BUG-101 内容確認", () => {
  it("発注日(日本時間の日付)と内容確認の列を出す", () => {
    render(<PurchaseOrderTable {...baseProps({ orders: [order({ orderDate: "2026-11-14T23:00:00.000Z" })] })} />);
    expect(screen.getByRole("columnheader", { name: /発注日/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /内容確認/ })).toBeInTheDocument();
    expect(within(screen.getAllByRole("row")[1]).getByText("2026-11-15")).toBeInTheDocument();
  });

  it("内容確認を押すと onPreview を呼び、行の編集は開かない", async () => {
    const onPreview = vi.fn();
    const onSelectEdit = vi.fn();
    render(<PurchaseOrderTable {...baseProps({ onPreview, onSelectEdit })} />);
    await userEvent.click(screen.getByRole("button", { name: /内容確認/ }));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "PO-1" }));
    expect(onSelectEdit).not.toHaveBeenCalled();
  });
});

describe("PurchaseOrderPreview(BUG-101)", () => {
  it("件名・仕入先・発注日・納期・元の購買申請・明細・添付・合計を出す", () => {
    render(
      <PurchaseOrderPreview
        order={order({
          orderDate: "2026-11-01",
          deliveryDate: "2026-11-20",
          requestId: "PR-9",
          totalAmount: 2200,
          items: [{ itemId: "ITEM1", quantity: 2, unitPrice: 1000 }],
          attachments: [{ id: "A1", fileName: "仕様書.pdf", storageType: "R2", downloadUrl: "https://example.com/s" }],
        })}
        suppliers={[{ id: "PARTNER-1", name: "部品商事" }]}
        allItems={[{ id: "ITEM1", name: "ネジ" }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("テスト発注")).toBeInTheDocument();
    expect(screen.getByText("部品商事")).toBeInTheDocument();
    expect(screen.getByText("2026-11-01 / 2026-11-20")).toBeInTheDocument();
    expect(screen.getByText("PR-9")).toBeInTheDocument();
    expect(screen.getByText("ネジ")).toBeInTheDocument();
    expect(screen.getByText("¥2,000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /仕様書\.pdf/ })).toHaveAttribute("href", "https://example.com/s");
    expect(screen.getByText("¥2,200")).toBeInTheDocument();
  });
});
