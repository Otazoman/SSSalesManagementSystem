import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRoles } from "./useRoles";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockCompanySettingsAndRoles(fetchSpy: ReturnType<typeof vi.fn>, roles: unknown[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    if (url.toString().includes("/api/company-settings")) {
      return jsonResponse({ is_pagination_enabled: false });
    }
    if (url.toString().includes("/api/roles")) {
      return jsonResponse(roles);
    }
    return jsonResponse({});
  });
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRoles", () => {
  it("初期状態: ロール一覧を取得する", async () => {
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy, [{ id: "admin", name: "管理者", description: null, createdAt: "" }]);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useRoles(true, false));

    await waitFor(() => expect(result.current.roles.length).toBe(1));
  });

  it("createRole: POSTしメッセージを設定して再取得する", async () => {
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useRoles(true, false));
    await waitFor(() => expect(result.current.roles).toEqual([]));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/roles") && init?.method === "POST") {
        expect(JSON.parse(init.body as string)).toEqual({
          id: "finance_checker",
          name: "経理検収担当",
          description: "説明",
        });
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.createRole("finance_checker", "経理検収担当", "説明");
    });

    expect(result.current.message).toBe("新しい業務ロールを作成しました");
  });

  it("updateRole: PUTしeditingIdをクリアする", async () => {
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useRoles(true, false));
    await waitFor(() => expect(result.current.roles).toEqual([]));

    act(() => result.current.setEditingId("finance_checker"));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/roles/finance_checker") && init?.method === "PUT") {
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.updateRole("finance_checker", "経理検収担当２", "");
    });

    expect(result.current.message).toBe("業務ロール情報を更新しました");
    expect(result.current.editingId).toBeNull();
  });

  it("deleteRole: DELETEしメッセージを設定する", async () => {
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useRoles(true, false));
    await waitFor(() => expect(result.current.roles).toEqual([]));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/roles/finance_checker") && init?.method === "DELETE") {
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.deleteRole("finance_checker");
    });

    expect(result.current.message).toBe("業務ロールを削除しました");
  });

  it("失敗時はhandleCatchError経由でerrorを設定する", async () => {
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useRoles(true, false));
    await waitFor(() => expect(result.current.roles).toEqual([]));

    fetchSpy.mockImplementation(async () => jsonResponse({ message: "IDが重複しています" }, 400));

    await act(async () => {
      await result.current.createRole("admin", "管理者", "");
    });

    expect(result.current.error).toBe("IDが重複しています");
  });

  it("importCsv: multipart/form-dataでPOSTし、成功メッセージを反映する", async () => {
    const fetchSpy = vi.fn();
    mockCompanySettingsAndRoles(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useRoles(true, false));
    await waitFor(() => expect(result.current.roles).toEqual([]));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/roles/bulk-register")) {
        expect(init?.body).toBeInstanceOf(FormData);
        return jsonResponse({ message: "2件取り込みました" });
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.importCsv(new File(["id,name"], "roles.csv"));
    });

    expect(result.current.message).toBe("2件取り込みました");
  });
});
