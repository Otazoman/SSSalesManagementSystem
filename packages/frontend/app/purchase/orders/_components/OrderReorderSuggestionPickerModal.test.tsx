import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrderReorderSuggestionPickerModal } from "./OrderReorderSuggestionPickerModal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// J-2-g: 発注点/安全在庫を下回っている品目候補から、購買申請を経由せず直接発注を作成する。
// 候補には取引先(仕入先)の情報が無いため、partnerIdは常にnullで渡し画面側で選択させる
describe("OrderReorderSuggestionPickerModal: 発注点/安全在庫の候補から発注を作成する", () => {
  it("候補を選択して確定すると、onPrefillにpartnerId:null・itemsが正しく渡る", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/item-reorder-settings/low-stock-candidates")) {
        return jsonResponse([
          {
            id: "CAND-1",
            itemId: "ITEM-1",
            itemName: "テスト品目",
            baseUnitCode: "PCS",
            taxCategoryCode: "TAX_10",
            warehouseId: "WH-1",
            warehouseName: "本社倉庫",
            reorderPoint: 10,
            safetyStock: 5,
            currentStock: 3,
            suggestedQuantity: 20,
          },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const onPrefill = vi.fn();
    render(<OrderReorderSuggestionPickerModal onClose={vi.fn()} onPrefill={onPrefill} />);

    await waitFor(() => expect(screen.getByText("テスト品目")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/発注フォームへ内容をコピー/));

    expect(onPrefill).toHaveBeenCalledTimes(1);
    const data = onPrefill.mock.calls[0][0];
    expect(data.partnerId).toBeNull();
    expect(data.requestId).toBeNull();
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      itemId: "ITEM-1",
      quantity: 20,
      unitPrice: 0,
    });
  });

  it("候補が0件の場合はエラーメッセージを表示し、コピーボタンは無効化される", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );

    render(<OrderReorderSuggestionPickerModal onClose={vi.fn()} onPrefill={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("発注点を下回っている品目はありません。")).toBeInTheDocument(),
    );
    expect(screen.getByText(/発注フォームへ内容をコピー/)).toBeDisabled();
  });
});
