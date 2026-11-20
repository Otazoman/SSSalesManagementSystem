import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DisposalHistoryPanel } from "./DisposalHistoryPanel";

// BUG-093: 廃棄履歴の作成者は、従業員番号ではなく氏名で出す(引けなければ番号のまま)
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DisposalHistoryPanel(BUG-093)", () => {
  it("作成者の列に氏名を出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/users")) return json([{ id: "u1", employeeNumber: "E001", name: "在庫太郎" }]);
        if (url.includes("/api/stock-disposals")) {
          return json([
            { id: "DSP-1", itemId: "ITEM-1", warehouseId: "WH-1", locationId: "LOC-1", lotNumber: "NONE", accountCode: "A", qualityStatus: "DAMAGED", quantity: 1, status: "APPROVED", memo: null, createdBy: "E001", createdAt: "2026-11-15T00:00:00.000Z" },
            { id: "DSP-2", itemId: "ITEM-1", warehouseId: "WH-1", locationId: "LOC-1", lotNumber: "NONE", accountCode: "A", qualityStatus: "DAMAGED", quantity: 2, status: "APPROVED", memo: null, createdBy: "E999", createdAt: "2026-11-15T00:00:00.000Z" },
          ]);
        }
        return json([]);
      }),
    );
    render(<DisposalHistoryPanel />);
    await waitFor(() => expect(screen.getAllByText("在庫太郎").some((el) => el.tagName === "TD")).toBe(true));
    expect(screen.getAllByText("E999").some((el) => el.tagName === "TD")).toBe(true);
  });
});
