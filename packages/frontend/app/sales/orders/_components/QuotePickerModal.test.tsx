import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QuotePickerModal } from "./QuotePickerModal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const quote = { id: "QT-1", title: "テスト見積", partnerId: "CUST-1", status: "APPROVED", totalAmount: 33000 };
const quoteItems = [
  { id: "QI-1", itemId: "ITEM-1", itemName: "製品X", inputType: "MASTER", quantity: 30, unitPrice: 1000 },
  { id: "QI-2", itemId: "ITEM-2", itemName: "設置作業", inputType: "MASTER", quantity: 8, unitPrice: 500 },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/sales-orders/quote-progress/QT-1")) {
        return jsonResponse([
          { quoteItemId: "QI-1", quantity: 30, orderedQuantity: 10, remainingQuantity: 20 },
          { quoteItemId: "QI-2", quantity: 8, orderedQuantity: 8, remainingQuantity: 0 },
        ]);
      }
      if (u.includes("/api/quotes/QT-1")) return jsonResponse({ items: quoteItems });
      if (u.includes("/api/quotes")) return jsonResponse([quote]);
      return jsonResponse({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuotePickerModal: BUG-059 分割受注の受注済み数量・残数量", () => {
  it("見積数量・既受注数量・残数量を表示し、残数量を初期値にする(残数量0の明細は選択しない)", async () => {
    render(<QuotePickerModal onClose={vi.fn()} onPrefill={vi.fn()} />);

    fireEvent.click(await screen.findByText("QT-1"));
    await waitFor(() => expect(screen.getByText("既受注数量")).toBeInTheDocument());

    const row1 = screen.getByText("製品X").closest("tr")!;
    expect(within(row1).getByText("10")).toBeInTheDocument();
    expect(within(row1).getByText("20")).toBeInTheDocument();
    expect(within(row1).getByRole("spinbutton")).toHaveValue(20);
    expect(within(row1).getByRole("checkbox")).toBeChecked();

    const row2 = screen.getByText("設置作業").closest("tr")!;
    expect(within(row2).getByRole("checkbox")).not.toBeChecked();
  });

  it("受注済みの数量を取得できなかった場合も、見積数量を初期値にして選べる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = url.toString();
        if (u.includes("/api/sales-orders/quote-progress/")) return jsonResponse({ message: "error" }, 500);
        if (u.includes("/api/quotes/QT-1")) return jsonResponse({ items: quoteItems });
        if (u.includes("/api/quotes")) return jsonResponse([quote]);
        return jsonResponse({});
      }),
    );
    render(<QuotePickerModal onClose={vi.fn()} onPrefill={vi.fn()} />);

    fireEvent.click(await screen.findByText("QT-1"));

    const row1 = (await screen.findByText("製品X")).closest("tr")!;
    expect(within(row1).getByRole("spinbutton")).toHaveValue(30);
    expect(within(row1).getByRole("checkbox")).toBeChecked();
  });
});
