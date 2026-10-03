import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "./page";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(roleId: string, permissions: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (u.includes("/api/auth/profile")) return jsonResponse({ id: "u1", roleId, permissions });
      if (u.includes("/api/company-settings") && init?.method === "PUT") {
        return jsonResponse({});
      }
      if (u.includes("/api/company-settings")) {
        return jsonResponse({ company_name: "テスト会社", is_pagination_enabled: false });
      }
      return jsonResponse({});
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminCompanySettingsPage", () => {
  it("初期化中はローディング表示になる", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<Page />);
    expect(screen.getByText("🔒 セキュリティ権限の検証中...")).toBeInTheDocument();
  });

  it("画面アクセス権限が無い場合は権限エラーを表示する", async () => {
    mockFetch("general_user", []);
    render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("⚠️ この画面を閲覧する権限がありません。")).toBeInTheDocument(),
    );
  });

  it("adminの場合は設定フォームを表示し、保存クリックでPUTする", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal(
      "fetch",
      fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
        const u = url.toString();
        if (u.includes("/api/auth/profile")) return jsonResponse({ id: "u1", roleId: "admin" });
        if (u.includes("/api/company-settings") && init?.method === "PUT") return jsonResponse({});
        if (u.includes("/api/company-settings"))
          return jsonResponse({ company_name: "テスト会社", is_pagination_enabled: false });
        return jsonResponse({});
      }),
    );

    render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("🏢 会社・システム設定")).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: "マスタ設定を保存する 💾" }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/company-settings",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("read権限のみの場合は閲覧専用バッジを表示し保存ボタンを無効化する", async () => {
    mockFetch("general_user", ["company_settings:menu", "company_settings:read"]);
    render(<Page />);
    await waitFor(() => expect(screen.getByText("👁️ 閲覧専用モード")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "マスタ設定を保存する 💾" })).toBeDisabled();
  });
});
