import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SalesOrderShortagePickerModal } from "./SalesOrderShortagePickerModal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Item9設計確定: 受注欠品から発注を作成する際、受注のpartnerId(得意先)を発注のpartnerId(仕入先)に
// 絶対に引き継いではいけない(得意先と仕入先は別人格のため、混同すると誤った取引先へ発注してしまう)。
// requisitions側のSalesOrderPickerModalを移植した際に最も壊れやすい箇所のため、専用に固定する
describe("SalesOrderShortagePickerModal: partnerId(得意先)を発注へ引き継がない", () => {
  it("受注を選んで明細をコピーしても、onPrefillのpartnerIdはnullになる", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/sales-orders/SO-1")) {
        return jsonResponse({
          items: [
            {
              id: "SOI-1",
              itemId: "ITEM-1",
              itemName: "テスト品目",
              inputType: "MASTER",
              quantity: 10,
              unitPrice: 1000,
              unitCode: "PCS",
              taxCategoryCode: "TAX_10",
              backorderedQuantity: 3,
            },
          ],
        });
      }
      if (u.includes("/api/sales-orders")) {
        // 受注のpartnerIdは得意先(CUST-1)であり、これが発注側に漏れ出さないことを確認する
        return jsonResponse([{ id: "SO-1", title: "テスト受注", partnerId: "CUST-1" }]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const onPrefill = vi.fn();
    render(<SalesOrderShortagePickerModal onClose={vi.fn()} onPrefill={onPrefill} />);

    await waitFor(() => expect(screen.getByText("SO-1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("SO-1"));

    await waitFor(() => expect(screen.getByText(/発注フォームへ内容をコピー/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/発注フォームへ内容をコピー/));

    expect(onPrefill).toHaveBeenCalledTimes(1);
    const data = onPrefill.mock.calls[0][0];
    expect(data.partnerId).toBeNull();
    expect(data.requestId).toBeNull();
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      itemId: "ITEM-1",
      quantity: 3,
      salesOrderItemId: "SOI-1",
    });
  });
});
