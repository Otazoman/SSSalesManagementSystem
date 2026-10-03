import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePurchaseOrderOperations } from "./usePurchaseOrderOperations";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("usePurchaseOrderOperations: BUG-061 CSV取込の上書きの確認", () => {
  const csvFile = () => new File(["id"], "orders.csv", { type: "text/csv" });
  const setup = () => {
    const fetchSpy = vi.fn(async (url: string) => (url.toString().includes("bulk-register") ? json({ message: "ok" }) : json([])));
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      usePurchaseOrderOperations({ canRead: true, isPurchaseOrderWfEnabled: false }),
    );
    const bulkCalls = () => fetchSpy.mock.calls.filter(([url]) => url.toString().includes("/api/purchase-orders/bulk-register"));
    return { result, bulkCalls };
  };

  it("取込の前に上書きの確認を出し、キャンセルなら取り込まない", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result, bulkCalls } = setup();

    await act(async () => {
      await result.current.handleImportCsv(csvFile());
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("上書きされます"));
    expect(bulkCalls()).toHaveLength(0);
  });

  it("確認で続けると取り込む", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, bulkCalls } = setup();

    await act(async () => {
      await result.current.handleImportCsv(csvFile());
    });

    expect(bulkCalls()).toHaveLength(1);
  });
});
