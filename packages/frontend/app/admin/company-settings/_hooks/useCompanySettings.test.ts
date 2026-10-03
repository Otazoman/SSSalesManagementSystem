import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCompanySettings } from "./useCompanySettings";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch({
  roleId = "admin",
  permissions = [] as string[],
  settingsOverrides = {},
}: { roleId?: string; permissions?: string[]; settingsOverrides?: Record<string, unknown> } = {}) {
  const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (url) => {
    const u = url.toString();
    if (u.includes("/api/auth/profile")) {
      return jsonResponse({ id: "u1", roleId, permissions });
    }
    if (u.includes("/api/company-settings/test-email")) {
      return jsonResponse({ message: "テストメールを送信しました" });
    }
    if (u.includes("/api/company-settings")) {
      return jsonResponse({ company_name: "テスト会社", is_pagination_enabled: false, ...settingsOverrides });
    }
    return jsonResponse({});
    },
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCompanySettings", () => {
  it("adminロールの場合は全権限がtrueになる", async () => {
    mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useCompanySettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMenuAccess).toBe(true);
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(true);
    expect(result.current.settings.company_name).toBe("テスト会社");
  });

  it("非adminは権限配列からcanRead/canWrite/hasMenuAccessを判定する", async () => {
    mockFetch({
      roleId: "general_user",
      permissions: ["company_settings:menu", "company_settings:read"],
    });
    const { result } = renderHook(() => useCompanySettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMenuAccess).toBe(true);
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it("プロフィール/設定取得のいずれかが失敗した場合はエラーを設定する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.toString().includes("/api/auth/profile")) return jsonResponse({}, 500);
        return jsonResponse({});
      }),
    );
    const { result } = renderHook(() => useCompanySettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("システム初期化中にエラーが発生しました");
  });

  it("saveSettingsはcanWrite:falseの場合エラーを設定しPUTしない", async () => {
    const fetchSpy = mockFetch({ roleId: "general_user", permissions: [] });
    const { result } = renderHook(() => useCompanySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveSettings();
    });

    expect(result.current.error).toBe(
      "あなたにはこの設定を変更する権限(更新権限)がありません",
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/api/company-settings",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("saveSettingsはcanWrite:trueの場合設定全体をPUTし成功メッセージを設定する", async () => {
    const fetchSpy = mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useCompanySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSettings((prev) => ({ ...prev, is_pagination_enabled: true }));
    });

    await act(async () => {
      await result.current.saveSettings();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/company-settings",
      expect.objectContaining({ method: "PUT", credentials: "include" }),
    );
    const call = fetchSpy.mock.calls.find(
      (c) => c[0] === "/api/company-settings" && (c[1] as RequestInit).method === "PUT",
    );
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body.is_pagination_enabled).toBe(true);
    expect(result.current.message).toBe("Cloudflare KVマスタ設定を上書き更新しました");
  });

  it("saveSettings失敗時はdata.messageをerrorへ設定する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = url.toString();
        if (u.includes("/api/auth/profile")) return jsonResponse({ roleId: "admin" });
        if (u.includes("/api/company-settings") && init?.method === "PUT") {
          return jsonResponse({ message: "更新に失敗しました" }, 500);
        }
        if (u.includes("/api/company-settings")) return jsonResponse({ company_name: "テスト会社" });
        return jsonResponse({});
      }),
    );
    const { result } = renderHook(() => useCompanySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveSettings();
    });

    expect(result.current.error).toBe("更新に失敗しました");
  });

  it("sendTestEmailは送信先未入力の場合何もしない", async () => {
    const fetchSpy = mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useCompanySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.sendTestEmail();
    });

    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/api/company-settings/test-email",
      expect.anything(),
    );
  });

  it("sendTestEmailは送信先入力時にテストメールを送信しtestMessageを設定する", async () => {
    mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useCompanySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setTestEmail("test@example.com");
    });

    await act(async () => {
      await result.current.sendTestEmail();
    });

    expect(result.current.testMessage).toBe("テストメールを送信しました");
  });
});
