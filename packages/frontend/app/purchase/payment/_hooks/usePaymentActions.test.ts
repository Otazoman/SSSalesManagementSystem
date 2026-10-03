import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePaymentActions } from "./usePaymentActions";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderActions(handleImportCSV = vi.fn(async () => true)) {
  const { result } = renderHook(() =>
    usePaymentActions({
      syncPayments: vi.fn(async () => {}),
      handleImportCSV,
      setMessage: vi.fn(),
      setError: vi.fn(),
    }),
  );
  return { result, handleImportCSV };
}

const fileEvent = () => {
  const file = new File(["header"], "recon.csv", { type: "text/csv" });
  return { target: { files: [file], value: "recon.csv" } } as unknown as React.ChangeEvent<HTMLInputElement>;
};

describe("usePaymentActions: BUG-060 支払消込のCSV取込", () => {
  it("記録を追加する取込であることを確認し、支払消込の取込先へ送る", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, handleImportCSV } = renderActions();

    await act(async () => {
      await result.current.handleDisbursementsCSVImportChange(fileEvent());
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("2回取り込むとエラー"));
    expect(handleImportCSV).toHaveBeenCalledWith(expect.any(File), "/api/purchase-payments/disbursements/bulk-register");
  });

  it("確認でキャンセルすると取り込まない", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result, handleImportCSV } = renderActions();

    await act(async () => {
      await result.current.handleDisbursementsCSVImportChange(fileEvent());
    });

    expect(handleImportCSV).not.toHaveBeenCalled();
  });
});
