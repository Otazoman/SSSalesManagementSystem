import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrderSaveActions } from "./useOrderSaveActions";

// BUG-074: 受注の保存で、プロジェクト(見積から引き継いだもの・画面で選んだもの)を送る(以前は送っておらず保存されなかった)
afterEach(() => vi.unstubAllGlobals());

const basePayload = {
  orderId: "",
  orderTitle: "件名",
  partnerId: "P-1",
  sourceQuoteId: "QT-1",
  orderDate: "2026-11-03",
  status: "DRAFT",
  totalAmount: 1100,
  taxAmount: 100,
  memo: "",
  terms: "",
  companyDepartment: "",
  salesPersonEmployeeNumber: "EMP0002",
  inputPersonEmployeeNumber: "EMP0002",
  items: [{ itemId: "ITEM-1", itemName: "品目", inputType: "MASTER", quantity: 1, unitPrice: 1000 }],
  attachments: [],
  selectedFiles: {},
  companyName: "",
  companyAddress: "",
  companyTel: "",
  companyFax: "",
  deliveryDate: "",
  deliveryPlace: "",
  deliveryDestinationId: null,
  paymentTerms: "",
  projectId: "PJ-1",
  isPrepaid: false,
  prepaidAt: null,
};

function renderSaveActions(editingId: string | null) {
  return renderHook(() =>
    useOrderSaveActions({
      partners: [],
      editingId,
      setEditingId: vi.fn(),
      setOrderId: vi.fn(),
      setViewMode: vi.fn(),
      filters: {},
      filterStatus: "all",
      syncOrders: vi.fn(async () => {}),
      setError: vi.fn(),
      setMessage: vi.fn(),
      setWarning: vi.fn(),
      setIsSubmitting: vi.fn(),
    }),
  );
}

describe("useOrderSaveActions: プロジェクトの保存(BUG-074)", () => {
  it("新規登録でプロジェクトを送る", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ id: "SO-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderSaveActions(null);
    await act(async () => {
      await result.current.handleFormSubmitAction(basePayload);
    });
    const body = fetchSpy.mock.calls[0][1]!.body as FormData;
    expect(JSON.parse(String(body.get("orderData"))).projectId).toBe("PJ-1");
  });

  it("プロジェクトが空なら null を送る", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ id: "SO-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderSaveActions("SO-1");
    await act(async () => {
      await result.current.handleFormSubmitAction({ ...basePayload, projectId: "" });
    });
    const body = fetchSpy.mock.calls[0][1]!.body as FormData;
    expect(JSON.parse(String(body.get("orderData"))).projectId).toBeNull();
  });
});
