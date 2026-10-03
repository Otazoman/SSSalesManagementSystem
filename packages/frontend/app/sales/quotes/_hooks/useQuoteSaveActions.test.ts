import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQuoteSaveActions } from "./useQuoteSaveActions";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const payload = (status: string) => ({
  quoteId: "QT-1-1",
  quoteTitle: "テスト見積",
  customerId: "CUST-1",
  quoteDate: "2026-10-01",
  validUntil: "",
  status,
  totalAmount: 1100,
  taxAmount: 100,
  memo: "",
  terms: "",
  companyDepartment: "",
  salesPersonEmployeeNumber: "E001",
  inputPersonEmployeeNumber: "E001",
  items: [{ itemId: "PROD-1", itemName: "品目A", inputType: "MASTER", quantity: 1, unitPrice: 1000 }],
  attachments: [],
  selectedFiles: {},
});

function renderSaveActions(editingId: string | null) {
  return renderHook(() =>
    useQuoteSaveActions({
      partners: [{ id: "CUST-1", name: "得意先A" }],
      editingId,
      setEditingId: vi.fn(),
      setQuoteId: vi.fn(),
      setViewMode: vi.fn(),
      filters: {},
      filterStatus: "",
      syncQuotes: vi.fn(async () => {}),
      setError: vi.fn(),
      setMessage: vi.fn(),
      setIsSubmitting: vi.fn(),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useQuoteSaveActions: BUG-058 保存後の確認画面", () => {
  it("編集で確定(APPROVED)にして保存した時は、確定済みとして記録する(「このまま確定する」を出さない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ success: true })));
    const { result } = renderSaveActions("QT-1-1");

    await act(async () => {
      await result.current.handleFormSubmitAction(payload("APPROVED"), false);
    });

    expect(result.current.savedQuoteSummary?.isConfirmed).toBe(true);
  });

  it("新規登録は、確定を選んでいても下書きで保存されるため、確定済みにはしない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ success: true, id: "QT-2-1" })));
    const { result } = renderSaveActions(null);

    await act(async () => {
      await result.current.handleFormSubmitAction(payload("APPROVED"), false);
    });

    expect(result.current.savedQuoteSummary?.isConfirmed).toBe(false);
  });

  it("編集で下書きのまま保存した時は、確定済みにしない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ success: true })));
    const { result } = renderSaveActions("QT-1-1");

    await act(async () => {
      await result.current.handleFormSubmitAction(payload("DRAFT"), false);
    });

    expect(result.current.savedQuoteSummary?.isConfirmed).toBe(false);
  });
});

describe("useQuoteSaveActions: 明細IDを送る(受注明細とのつながりを保つ)", () => {
  const sentItems = (fetchSpy: { mock: { calls: Array<[string, RequestInit?]> } }) => {
    const [, init] = fetchSpy.mock.calls.find(([url]) => url.toString().includes("/api/quotes/QT-1-1"))!;
    return JSON.parse((init!.body as FormData).get("quoteData") as string).items;
  };

  it("編集の保存では、読み込んだ明細のIDをそのまま送る(新しく追加した明細はIDなし)", async () => {
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderSaveActions("QT-1-1");
    const p = {
      ...payload("DRAFT"),
      items: [
        { id: "QT-1-1-L1", itemId: "PROD-1", itemName: "品目A", inputType: "MASTER", quantity: 2, unitPrice: 1000 },
        { itemId: "PROD-2", itemName: "品目B", inputType: "MASTER", quantity: 1, unitPrice: 500 },
      ],
    };

    await act(async () => {
      await result.current.handleFormSubmitAction(p, false);
    });

    expect(sentItems(fetchSpy).map((i: { id?: string | null }) => i.id ?? null)).toEqual(["QT-1-1-L1", null]);
  });

  it("承認済み見積の変更申請でも、明細のIDを送る", async () => {
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderSaveActions("QT-1-1");
    const p = {
      ...payload("APPROVED"),
      items: [{ id: "QT-1-1-L1", itemId: "PROD-1", itemName: "品目A", inputType: "MASTER", quantity: 2, unitPrice: 1000 }],
    };

    await act(async () => {
      await result.current.handleSubmitApprovedEditAction(p);
    });

    const [, init] = fetchSpy.mock.calls.find(([url]) => url.toString().includes("/api/approvals/request-update"))!;
    expect(JSON.parse(init!.body as string).payload.items.map((i: { id?: string | null }) => i.id)).toEqual(["QT-1-1-L1"]);
  });
});
