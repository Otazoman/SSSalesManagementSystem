import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseRequisitionTable } from "./PurchaseRequisitionTable";
import { PurchaseRequisitionPreview } from "./PurchaseRequisitionPreview";
import { PurchaseRequisitionRecord } from "../_types";

// BUG-099: 購買申請の一覧に、申請日(作成日)・添付のあり/なし・内容確認を出す
function record(overrides: Partial<PurchaseRequisitionRecord> = {}): PurchaseRequisitionRecord {
  return {
    id: "PR-1",
    title: "文具の購入",
    departmentSurrogateId: "dept-a",
    applicantId: "EMP001",
    requestType: "ONE_TIME",
    status: "DRAFT",
    totalAmount: 1100,
    memo: null,
    // 日本時間の 2026-11-15 08:00(UTC では前日)
    createdAt: "2026-11-14T23:00:00.000Z",
    attachments: [],
    ...overrides,
  };
}

function renderTable(requisitions: PurchaseRequisitionRecord[], onPreview = vi.fn()) {
  render(
    <PurchaseRequisitionTable
      requisitions={requisitions}
      canCreate
      canUpdate
      canDelete
      isSubmitting={false}
      onSelectEdit={vi.fn()}
      onDeleteLink={vi.fn()}
      onCopyToNewDraft={vi.fn()}
      onPreview={onPreview}
    />,
  );
  return onPreview;
}

describe("PurchaseRequisitionTable(BUG-099)", () => {
  it("申請日は入力者の後に並ぶ(BUG-104。見積の一覧と同じ順)", () => {
    renderTable([record()]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    const input = headers.findIndex((h) => h.includes("入力者"));
    expect(headers.findIndex((h) => h.includes("申請日"))).toBe(input + 1);
  });

  it("申請日(日本時間の作成日)・添付・内容確認の列を出す", () => {
    renderTable([record(), record({ id: "PR-2", attachments: [{ fileName: "見積書.pdf", storageType: "R2" }] })]);
    for (const label of ["申請日", "添付", "内容確認"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(label) })).toBeInTheDocument();
    }
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("2026-11-15")).toBeInTheDocument();
    expect(within(rows[1]).getByText("なし")).toBeInTheDocument();
    expect(within(rows[2]).getByText("📎 あり")).toBeInTheDocument();
  });

  it("合計金額の後にステータスが並ぶ(見積の一覧と同じ順)", () => {
    renderTable([record()]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    const total = headers.findIndex((h) => h.includes("合計金額"));
    expect(headers.findIndex((h) => h.includes("ステータス"))).toBe(total + 1);
  });

  it("内容確認を押すと onPreview を呼ぶ(行の編集は開かない)", async () => {
    const onPreview = renderTable([record()]);
    await userEvent.click(screen.getByRole("button", { name: "確認" }));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "PR-1" }));
  });
});

describe("PurchaseRequisitionTable(BUG-102)", () => {
  it("申請者・入力者をユーザーの名前で出す(ユーザーが見つからなければ従業員番号)", () => {
    render(
      <PurchaseRequisitionTable
        requisitions={[record({ applicantId: "E001", inputPersonEmployeeNumber: "E999" })]}
        canCreate
        canUpdate
        canDelete
        isSubmitting={false}
        onSelectEdit={vi.fn()}
        onDeleteLink={vi.fn()}
        onCopyToNewDraft={vi.fn()}
        userMaster={[{ id: "u1", name: "申請花子", employeeNumber: "E001" }]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /申請者/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /入力者/ })).toBeInTheDocument();
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("申請花子")).toBeInTheDocument();
    expect(within(row).getByText("E999")).toBeInTheDocument();
  });
});

describe("PurchaseRequisitionPreview(BUG-099)", () => {
  it("件名・仕入先(マスタの名前)・申請日・明細(品目マスタの名前)・添付・合計を出す", () => {
    render(
      <PurchaseRequisitionPreview
        requisition={record({
          partnerId: "S-1",
          partnerInputType: "MASTER",
          items: [{ itemId: "ITEM1", quantity: 2, estimatedUnitPrice: 500 }],
          attachments: [{ id: "A1", fileName: "見積書.pdf", storageType: "R2", downloadUrl: "https://example.com/a" }],
        })}
        suppliers={[{ id: "S-1", name: "文具商事" }]}
        allItems={[{ id: "ITEM1", name: "ボールペン" }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("文具の購入")).toBeInTheDocument();
    expect(screen.getByText("文具商事")).toBeInTheDocument();
    expect(screen.getByText(/2026-11-15/)).toBeInTheDocument();
    expect(screen.getByText("ボールペン")).toBeInTheDocument();
    expect(screen.getByText("¥1,000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /見積書\.pdf/ })).toHaveAttribute("href", "https://example.com/a");
    expect(screen.getByText("¥1,100")).toBeInTheDocument();
  });

  it("手入力の仕入先は入力した名前を出す。添付が無ければ「なし」", () => {
    render(
      <PurchaseRequisitionPreview
        requisition={record({ partnerInputType: "DIRECT", partnerName: "手入力商店" })}
        suppliers={[]}
        allItems={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("手入力商店")).toBeInTheDocument();
    expect(screen.getByText("なし")).toBeInTheDocument();
  });
});
