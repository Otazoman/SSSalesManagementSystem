import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useContactManagement } from "./useContactManagement";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function defaultProps() {
  return { canRead: true, canCreate: true, loading: false };
}

function mockRoutes(
  fetchSpy: ReturnType<typeof vi.fn>,
  contacts: unknown[] = [],
  partners: unknown[] = [],
  users: unknown[] = [],
) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/company-settings")) return jsonResponse({ is_pagination_enabled: false });
    if (u.includes("/api/partners")) return jsonResponse(partners);
    if (u.includes("/api/users")) return jsonResponse(users);
    if (u.includes("/api/partner-contacts")) return jsonResponse(contacts);
    return jsonResponse({});
  });
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useContactManagement", () => {
  it("初期表示: 取引先・ユーザーのlookupと担当者一覧を取得する", async () => {
    const fetchSpy = vi.fn();
    mockRoutes(
      fetchSpy,
      [{ id: "C1", partnerId: "P1", contactType: "CUSTOMER_CONTACT", status: "active" }],
      [{ id: "P1", name: "取引先A", status: "active" }],
      [{ id: "U1", name: "ユーザーA" }],
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useContactManagement(defaultProps()));

    await waitFor(() => expect(result.current.contacts.length).toBe(1));
    expect(result.current.partners).toEqual([{ id: "P1", name: "取引先A", status: "active" }]);
    expect(result.current.users).toEqual([{ id: "U1", name: "ユーザーA" }]);
  });

  it("承認ワークフロー有効時はfilterStatusの初期値がtemporaryになる", async () => {
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useContactManagement({ ...defaultProps(), isPartnerContactWfEnabled: true }),
    );

    await waitFor(() => expect(result.current.filterStatus).toBe("temporary"));
  });

  it("canCreate:falseの場合はCSVダウンロードでエラーメッセージを設定しfetchしない", async () => {
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useContactManagement({ ...defaultProps(), canCreate: false }),
    );
    await waitFor(() => expect(result.current.contacts).toEqual([]));

    fetchSpy.mockClear();
    await act(async () => {
      await result.current.handleDownloadCsv();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.error).toBe("CSVダウンロードする権限がありません");
  });

  it("削除確認でキャンセルした場合はDELETEを呼ばない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy, [
      { id: "C1", partnerId: "P1", contactType: "CUSTOMER_CONTACT", status: "active" },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useContactManagement(defaultProps()));
    await waitFor(() => expect(result.current.contacts.length).toBe(1));

    fetchSpy.mockClear();
    await act(async () => {
      await result.current.handleDeleteContact("C1");
    });

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/partner-contacts/C1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("無効化(承認ワークフロー無効)は/suspendエンドポイントを呼ぶ", async () => {
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy, [
      { id: "C1", partnerId: "P1", contactType: "CUSTOMER_CONTACT", status: "active" },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useContactManagement(defaultProps()));
    await waitFor(() => expect(result.current.contacts.length).toBe(1));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string) => {
      calledUrls.push(url.toString());
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSuspendContact("C1");
    });

    expect(calledUrls.some((u) => u.includes("/api/partner-contacts/C1/suspend"))).toBe(true);
  });

  it("無効化(承認ワークフロー有効)は仮登録PUT後にrequest-updateをUPDATEで申請する", async () => {
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy, [
      {
        id: "C1",
        partnerId: "P1",
        contactType: "CUSTOMER_CONTACT",
        internalUserId: null,
        name: "田中",
        email: null,
        phone: null,
        fax: null,
        departmentName: null,
        isEmailTarget: false,
        memo: null,
        status: "active",
      },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useContactManagement({ ...defaultProps(), isPartnerContactWfEnabled: true }),
    );
    await waitFor(() => expect(result.current.contacts.length).toBe(1));

    const calledUrls: { url: string; body: unknown }[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push({ url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : null });
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSuspendContact("C1");
    });

    const preSave = calledUrls.find((c) => c.url === "/api/partner-contacts/C1");
    expect((preSave!.body as { status: string }).status).toBe("temporary");
    const request = calledUrls.find((c) => c.url === "/api/approvals/request-update");
    expect((request!.body as { requestType: string }).requestType).toBe("UPDATE");
    expect(result.current.message).toBe(
      "担当者の無効化をワークフローへ申請しました(承認待ちロック)",
    );
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をrequest-updateのペイロードに含める", async () => {
    const fetchSpy = vi.fn();
    mockRoutes(fetchSpy, [
      {
        id: "C1",
        partnerId: "P1",
        contactType: "CUSTOMER_CONTACT",
        internalUserId: null,
        name: "田中",
        email: null,
        phone: null,
        fax: null,
        departmentName: null,
        isEmailTarget: false,
        memo: null,
        status: "active",
      },
    ]);
    vi.stubGlobal("fetch", fetchSpy);
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const { result } = renderHook(() =>
      useContactManagement({
        ...defaultProps(),
        isPartnerContactWfEnabled: true,
        departments,
      }),
    );
    await waitFor(() => expect(result.current.contacts.length).toBe(1));
    act(() => result.current.setApplicantDepartmentSurrogateId("dept-b"));

    const calledUrls: { url: string; body: unknown }[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push({ url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : null });
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSuspendContact("C1");
    });

    const request = calledUrls.find((c) => c.url === "/api/approvals/request-update");
    expect(
      (request!.body as { applicantDepartmentSurrogateId: string }).applicantDepartmentSurrogateId,
    ).toBe("dept-b");
  });
});
