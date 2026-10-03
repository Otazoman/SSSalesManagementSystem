import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useJournalPostingEvents } from "./useJournalPostingEvents";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const EVENTS = [
  {
    id: "E-1",
    sourceType: "purchase_order",
    sourceRefId: "PO-1",
    eventType: "PREPAYMENT",
    status: "FAILED",
    postedBatchId: null,
    retryCount: 0,
    errorMessage: "科目コードが見つかりません",
    requestedById: "EMP001",
    requestedAt: "2026-09-09T00:00:00.000Z",
    postedAt: null,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useJournalPostingEvents: 取得", () => {
  it("起票イベント一覧を取得する", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(EVENTS));
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useJournalPostingEvents());

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].id).toBe("E-1");
  });

  it("enabled=falseの間は取得しない", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(EVENTS));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useJournalPostingEvents(false));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useJournalPostingEvents: 再転記", () => {
  it("retryはPOST /api/journal-posting-events/:id/retryを呼び、成功メッセージを反映する", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (init?.method === "POST" && u.includes("/retry")) {
        return jsonResponse({ success: true, message: "再転記しました" });
      }
      return jsonResponse(EVENTS);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useJournalPostingEvents());
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    await act(async () => {
      await result.current.retry("E-1");
    });

    expect(result.current.message).toBe("再転記しました");
    const retryCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes("/retry"));
    expect(String(retryCall?.[0])).toContain("/api/journal-posting-events/E-1/retry");
  });

  it("再転記が失敗した場合はerrorへメッセージを反映する", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (init?.method === "POST" && u.includes("/retry")) {
        return jsonResponse({ success: false, message: "再転記に失敗しました: 科目が見つかりません" });
      }
      return jsonResponse(EVENTS);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useJournalPostingEvents());
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    await act(async () => {
      await result.current.retry("E-1");
    });

    expect(result.current.error).toContain("科目が見つかりません");
  });
});
