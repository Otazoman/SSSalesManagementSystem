import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PurchaseRecognitionReceiptLinkSection } from "./PurchaseRecognitionReceiptLinkSection";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockReceipts(list: unknown[]) {
  const spy = vi.fn(async () => jsonResponse({ data: list }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PurchaseRecognitionReceiptLinkSection", () => {
  it("仕入先が未選択の場合は案内を表示し、APIを呼ばない", () => {
    const spy = mockReceipts([]);

    render(
      <PurchaseRecognitionReceiptLinkSection partnerId="" selectedReceiptIds={[]} onChange={vi.fn()} />,
    );

    expect(screen.getByText(/仕入先を選択すると/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("仕入先の承認済み検収を候補として表示し、チェックで選択が追加される", async () => {
    const spy = mockReceipts([
      { id: "RCPT-1", receivedDate: "2026-09-09T00:00:00.000Z", orderId: "PO-1", supplierInvoiceNumber: "INV-9" },
    ]);
    const onChange = vi.fn();

    render(
      <PurchaseRecognitionReceiptLinkSection partnerId="P-1" selectedReceiptIds={[]} onChange={onChange} />,
    );

    await waitFor(() => expect(screen.getByText("RCPT-1")).toBeInTheDocument());
    const requested = String((spy.mock.calls[0] as unknown[])[0]);
    expect(requested).toContain("/api/stock-receipts?partnerId=P-1&status=APPROVED");
    expect(screen.getByText("発注: PO-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(["RCPT-1"]);
  });

  it("選択済みのチェックを外すと選択から取り除かれる", async () => {
    mockReceipts([{ id: "RCPT-1", receivedDate: null, orderId: null, supplierInvoiceNumber: null }]);
    const onChange = vi.fn();

    render(
      <PurchaseRecognitionReceiptLinkSection
        partnerId="P-1"
        selectedReceiptIds={["RCPT-1", "RCPT-2"]}
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(screen.getByText("RCPT-1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("checkbox").find((el) => (el as HTMLInputElement).checked && el.closest("li")?.textContent?.includes("RCPT-1"))!);
    expect(onChange).toHaveBeenCalledWith(["RCPT-2"]);
  });

  it("保存済みの紐づけが候補に無い場合も「紐づけ済み」として選択状態を表示する", async () => {
    mockReceipts([]);

    render(
      <PurchaseRecognitionReceiptLinkSection partnerId="P-1" selectedReceiptIds={["RCPT-OLD"]} onChange={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText("RCPT-OLD")).toBeInTheDocument());
    expect(screen.getByText("(紐づけ済み)")).toBeInTheDocument();
  });

  it("候補の取得に失敗した場合はエラーメッセージを表示する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "x" }, 500)));

    render(
      <PurchaseRecognitionReceiptLinkSection partnerId="P-1" selectedReceiptIds={[]} onChange={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText("検収記録の候補を取得できませんでした")).toBeInTheDocument());
  });
});
