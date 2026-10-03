import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Page from "./page";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TEMPLATE = {
  id: "quote",
  name: "見積書",
  smtpFrom: "sales@example.com",
  ccAddress: "",
  bccAddress: "",
  subjectTemplate: "件名",
  bodyTemplate: "本文",
  reportTemplatePath: null,
  reportLayoutStatus: null,
  reportLayoutError: null,
};

function mockFetch(roleId: string, permissions: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/auth/profile")) return jsonResponse({ id: "u1", roleId, permissions });
      if (u.endsWith("/api/mail-settings")) return jsonResponse([TEMPLATE]);
      if (u.includes("/api/company-settings")) return jsonResponse({ is_pagination_enabled: false });
      return jsonResponse({});
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminMailSettingsPage", () => {
  it("初期化中はローディング表示になる", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<Page />);
    expect(screen.getByText("🔒 セキュリティ権限の検証中...")).toBeInTheDocument();
  });

  it("画面アクセス権限が無い場合はAccessDeniedInlineを表示する", async () => {
    mockFetch("general_user", []);
    render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("⚠️ この画面を閲覧する権限がありません")).toBeInTheDocument(),
    );
  });

  it("adminの場合はテンプレート編集画面を表示する", async () => {
    mockFetch("admin");
    render(<Page />);
    await waitFor(() => expect(screen.getByText("✉️ メール送信設定")).toBeInTheDocument());
    expect(screen.getByText("見積書")).toBeInTheDocument();
    expect(screen.queryByText("👁️ 閲覧専用モード")).not.toBeInTheDocument();
  });

  it("read権限のみの場合は閲覧専用バッジを表示する", async () => {
    mockFetch("general_user", ["admin_mail_settings:menu", "admin_mail_settings:read"]);
    render(<Page />);
    await waitFor(() => expect(screen.getByText("👁️ 閲覧専用モード")).toBeInTheDocument());
  });
});
