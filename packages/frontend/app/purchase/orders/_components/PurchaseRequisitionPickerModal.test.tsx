import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PurchaseRequisitionPickerModal } from "./PurchaseRequisitionPickerModal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// BUG-116: 受注から作った購買申請(直送)から発注を作る時、明細の受注明細とのつながり(salesOrderItemId)を
// 発注へ引き継ぐ。引き継がないと、承認ありの運用(購買申請経由でしか発注を作れない)で直送完了にできない
describe("PurchaseRequisitionPickerModal: 受注明細とのつながりを発注へ引き継ぐ", () => {
  it("購買申請明細の salesOrderItemId と直送の指定が onPrefill に渡る", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/purchase-requisitions/PR-1")) {
        return jsonResponse({
          id: "PR-1",
          isDirectShipment: true,
          directSalesOrderId: "SO-1",
          items: [
            {
              id: "PRI-1",
              itemId: "ITEM-1",
              itemName: "テスト品目",
              inputType: "MASTER",
              quantity: 5,
              estimatedUnitPrice: 1000,
              unitCode: "PCS",
              taxCategoryCode: "TAX_10",
              salesOrderItemId: "SOI-1",
            },
          ],
        });
      }
      if (u.includes("/api/purchase-requisitions")) {
        return jsonResponse([
          { id: "PR-1", title: "直送の申請", partnerId: "SUP-1", totalAmount: 5000, projectId: null },
        ]);
      }
      if (u.includes("/api/sales-orders/SO-1")) {
        return jsonResponse({ id: "SO-1", partnerId: "CUST-1", deliveryPlace: null, deliveryDestinationId: null });
      }
      if (u.includes("/api/partners")) {
        return jsonResponse([{ id: "CUST-1", name: "得意先A" }]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const onPrefill = vi.fn();
    render(<PurchaseRequisitionPickerModal onClose={vi.fn()} onPrefill={onPrefill} />);

    await waitFor(() => expect(screen.getByText("PR-1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("PR-1"));

    await waitFor(() => expect(screen.getByText(/発注フォームへ内容をコピー/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/発注フォームへ内容をコピー/));

    await waitFor(() => expect(onPrefill).toHaveBeenCalledTimes(1));
    const data = onPrefill.mock.calls[0][0];
    expect(data.requestId).toBe("PR-1");
    expect(data.isDirectShipment).toBe(true);
    expect(data.directSalesOrderId).toBe("SO-1");
    expect(data.items[0]).toMatchObject({
      purchaseRequestItemId: "PRI-1",
      salesOrderItemId: "SOI-1",
    });
  });
});
