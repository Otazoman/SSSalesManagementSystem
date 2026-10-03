import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PurchaseOrderReorderPickerModal } from "./PurchaseOrderReorderPickerModal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// J-2-g: 過去の発注(仕入先PO-1の取引先ARTNER-1)を選んで再発注を作成する場合は、
// SalesOrderShortagePickerModalとは逆にpartnerId(仕入先)をそのまま引き継ぐのが正しい挙動
describe("PurchaseOrderReorderPickerModal: 過去の発注からpartnerId(仕入先)を引き継いで再発注を作成する", () => {
  it("発注を選んで明細をコピーすると、onPrefillにpartnerId・itemsが正しく渡る", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/purchase-orders/PO-1")) {
        return jsonResponse({
          items: [
            {
              id: "POI-1",
              itemId: "ITEM-1",
              itemName: "テスト品目",
              inputType: "MASTER",
              quantity: 5,
              unitPrice: 2000,
              unitCode: "PCS",
              taxCategoryCode: "TAX_10",
            },
          ],
        });
      }
      if (u.includes("/api/purchase-orders")) {
        return jsonResponse([{ id: "PO-1", title: "テスト発注", totalAmount: 10000, partnerId: "PARTNER-1" }]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const onPrefill = vi.fn();
    render(<PurchaseOrderReorderPickerModal onClose={vi.fn()} onPrefill={onPrefill} />);

    await waitFor(() => expect(screen.getByText("PO-1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("PO-1"));

    await waitFor(() => expect(screen.getByText(/発注フォームへ内容をコピー/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/発注フォームへ内容をコピー/));

    expect(onPrefill).toHaveBeenCalledTimes(1);
    const data = onPrefill.mock.calls[0][0];
    expect(data.partnerId).toBe("PARTNER-1");
    expect(data.requestId).toBeNull();
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      itemId: "ITEM-1",
      quantity: 5,
      unitPrice: 2000,
    });
  });

  it("明細を1件も選択しない状態でコピーしようとするとエラーになる", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/purchase-orders/PO-1")) {
        return jsonResponse({
          items: [
            {
              id: "POI-1",
              itemId: "ITEM-1",
              itemName: "テスト品目",
              inputType: "MASTER",
              quantity: 5,
              unitPrice: 2000,
              unitCode: "PCS",
              taxCategoryCode: "TAX_10",
            },
          ],
        });
      }
      if (u.includes("/api/purchase-orders")) {
        return jsonResponse([{ id: "PO-1", title: "テスト発注", totalAmount: 10000, partnerId: "PARTNER-1" }]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const onPrefill = vi.fn();
    render(<PurchaseOrderReorderPickerModal onClose={vi.fn()} onPrefill={onPrefill} />);

    await waitFor(() => expect(screen.getByText("PO-1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("PO-1"));

    await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText(/発注フォームへ内容をコピー/));

    expect(onPrefill).not.toHaveBeenCalled();
    expect(screen.getByText(/明細を1件以上選択してください/)).toBeInTheDocument();
  });
});
