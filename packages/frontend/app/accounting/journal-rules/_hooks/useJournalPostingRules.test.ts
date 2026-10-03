import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useJournalPostingRules } from "./useJournalPostingRules";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const RULES = [
  {
    eventType: "PREPAYMENT",
    variableAccountPriority: "ITEM_MASTER_FIRST",
    variableAccountFallbackCode: null,
    prepaidAccountCode: null,
    advanceReceivedAccountCode: null,
    cashAccountCode: null,
    payableAccountCode: null,
    receivableAccountCode: null,
    taxAccountCode: null,
    enabled: false,
    memo: null,
    updatedBy: null,
    updatedAt: null,
  },
  {
    eventType: "PURCHASE",
    variableAccountPriority: "ITEM_MASTER_FIRST",
    variableAccountFallbackCode: "5101",
    prepaidAccountCode: null,
    advanceReceivedAccountCode: null,
    cashAccountCode: null,
    payableAccountCode: "2101",
    receivableAccountCode: null,
    taxAccountCode: "1181",
    enabled: true,
    memo: null,
    updatedBy: "EMP001",
    updatedAt: "2026-09-09T00:00:00.000Z",
    patterns: [
      { documentType: "PURCHASE", lineKind: "BODY", debitFromItem: true, debitAccountCode: "5101", creditFromItem: false, creditAccountCode: "2101" },
      { documentType: "PURCHASE", lineKind: "TAX", debitFromItem: false, debitAccountCode: "1181", creditFromItem: false, creditAccountCode: "2101" },
    ],
  },
  {
    eventType: "ADVANCE_RECEIPT",
    variableAccountPriority: "ITEM_MASTER_FIRST",
    variableAccountFallbackCode: null,
    prepaidAccountCode: null,
    advanceReceivedAccountCode: null,
    cashAccountCode: null,
    payableAccountCode: null,
    receivableAccountCode: null,
    taxAccountCode: null,
    enabled: false,
    memo: null,
    updatedBy: null,
    updatedAt: null,
  },
  {
    eventType: "SALES",
    variableAccountPriority: "ITEM_MASTER_FIRST",
    variableAccountFallbackCode: null,
    prepaidAccountCode: null,
    advanceReceivedAccountCode: null,
    cashAccountCode: null,
    payableAccountCode: null,
    receivableAccountCode: null,
    taxAccountCode: null,
    enabled: false,
    memo: null,
    updatedBy: null,
    updatedAt: null,
  },
  ...(["RECEIPT", "DISBURSEMENT"] as const).map((eventType) => ({
    eventType,
    variableAccountPriority: "ITEM_MASTER_FIRST",
    variableAccountFallbackCode: null,
    prepaidAccountCode: null,
    advanceReceivedAccountCode: null,
    cashAccountCode: null,
    payableAccountCode: null,
    receivableAccountCode: null,
    taxAccountCode: null,
    enabled: false,
    memo: null,
    updatedBy: null,
    updatedAt: null,
  })),
];

const ACCOUNTS = [
  { code: "5101", name: "仕入高" },
  { code: "2101", name: "買掛金" },
  { code: "1181", name: "仮払消費税" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useJournalPostingRules: 取得", () => {
  it("固定6イベント種別すべてをeventTypeキーで引ける状態にする", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/journal-posting-rules")) return jsonResponse(RULES);
      if (u.includes("/api/accounts")) return jsonResponse(ACCOUNTS);
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useJournalPostingRules());

    await waitFor(() => expect(result.current.rules).not.toBeNull());
    expect(result.current.rules!.PURCHASE.payableAccountCode).toBe("2101");
    expect(result.current.rules!.PREPAYMENT.enabled).toBe(false);
    expect(result.current.rules!.RECEIPT.enabled).toBe(false);
    expect(result.current.rules!.DISBURSEMENT.enabled).toBe(false);
    expect(result.current.eventTypes).toHaveLength(6);
    expect(result.current.accounts).toHaveLength(3);
  });
});

describe("useJournalPostingRules: 保存", () => {
  it("saveRuleはPUT /api/journal-posting-rules/:eventTypeへローカル編集内容を送信する", async () => {
    let putBody: Record<string, unknown> | null = null;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (init?.method === "PUT" && u.includes("/api/journal-posting-rules/PURCHASE")) {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({ message: "更新しました" });
      }
      if (u.includes("/api/journal-posting-rules")) return jsonResponse(RULES);
      if (u.includes("/api/accounts")) return jsonResponse(ACCOUNTS);
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useJournalPostingRules());
    await waitFor(() => expect(result.current.rules).not.toBeNull());

    act(() => {
      result.current.updateRule("PURCHASE", { variableAccountPriority: "HEADER_FIRST" });
    });
    expect(result.current.rules!.PURCHASE.variableAccountPriority).toBe("HEADER_FIRST");

    await act(async () => {
      await result.current.saveRule("PURCHASE");
    });

    expect(putBody).not.toBeNull();
    expect(putBody!.variableAccountPriority).toBe("HEADER_FIRST");
    expect(putBody!.payableAccountCode).toBe("2101");
    expect(result.current.message).toBe("更新しました");
  });

  it("updatePatternで組の借方・貸方を変更し、保存時にpatternsとして送信する", async () => {
    let putBody: { patterns?: unknown } | null = null;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (init?.method === "PUT") {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({ message: "更新しました" });
      }
      if (u.includes("/api/journal-posting-rules")) return jsonResponse(RULES);
      if (u.includes("/api/accounts")) return jsonResponse(ACCOUNTS);
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useJournalPostingRules());
    await waitFor(() => expect(result.current.rules).not.toBeNull());

    act(() => {
      result.current.updatePattern("PURCHASE", 1, { debitAccountCode: "9999" });
    });
    await act(async () => {
      await result.current.saveRule("PURCHASE");
    });

    expect(putBody!.patterns).toEqual([
      { documentType: "PURCHASE", lineKind: "BODY", debitFromItem: true, debitAccountCode: "5101", creditFromItem: false, creditAccountCode: "2101" },
      { documentType: "PURCHASE", lineKind: "TAX", debitFromItem: false, debitAccountCode: "9999", creditFromItem: false, creditAccountCode: "2101" },
    ]);
  });

  it("保存失敗時はそのeventTypeのerrorにのみメッセージを格納する(他の行には影響しない)", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (init?.method === "PUT") {
        return jsonResponse({ success: false, message: "買掛金科目が必要です" }, 400);
      }
      if (u.includes("/api/journal-posting-rules")) return jsonResponse(RULES);
      if (u.includes("/api/accounts")) return jsonResponse(ACCOUNTS);
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useJournalPostingRules());
    await waitFor(() => expect(result.current.rules).not.toBeNull());

    await act(async () => {
      await result.current.saveRule("PREPAYMENT");
    });

    expect(result.current.errors.PREPAYMENT).toContain("買掛金科目が必要です");
    expect(result.current.errors.PURCHASE).toBeUndefined();
  });
});
