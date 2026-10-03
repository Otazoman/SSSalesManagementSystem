import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useMailSettings } from "./useMailSettings";

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

function mockFetch({
  roleId = "admin",
  permissions = [] as string[],
} = {}) {
  const fetchSpy = vi.fn(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/auth/profile")) {
      return jsonResponse({ id: "u1", name: "テストユーザー", roleId, permissions });
    }
    if (u.includes("/api/mail-settings/test-email")) {
      return jsonResponse({ message: "テストメールを送信しました" });
    }
    if (u.includes("/api/mail-settings/upload-file")) {
      return jsonResponse({ success: true, path: "report_templates/quote.xlsx" });
    }
    if (u.includes("/api/mail-settings/report-template/")) {
      return jsonResponse({});
    }
    if (u.endsWith("/api/mail-settings")) {
      return jsonResponse([TEMPLATE]);
    }
    if (u.includes("/api/company-settings")) {
      return jsonResponse({ is_pagination_enabled: false });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMailSettings", () => {
  it("adminロールの場合は全権限がtrueになる", async () => {
    mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useMailSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMenuAccess).toBe(true);
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(true);
    expect(result.current.activeTab).toBe("quote");
  });

  it("非adminは権限配列を見てcanRead/canWrite/hasMenuAccessを判定する", async () => {
    mockFetch({
      roleId: "general_user",
      permissions: ["admin_mail_settings:menu", "admin_mail_settings:read"],
    });
    const { result } = renderHook(() => useMailSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMenuAccess).toBe(true);
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it("handleSaveSettingsはcanWrite:falseの場合エラーを設定しPUTしない", async () => {
    const fetchSpy = mockFetch({ roleId: "general_user", permissions: [] });
    const { result } = renderHook(() => useMailSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleSaveSettings({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(result.current.error).toBe("あなたにはこの設定を変更する権限がありません");
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/mail-settings"),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("handleSaveSettingsはcanWrite:trueの場合現在のテンプレートをPUTする", async () => {
    const fetchSpy = mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useMailSettings());
    await waitFor(() => expect(result.current.currentTemplate).toBeDefined());

    await act(async () => {
      await result.current.handleSaveSettings({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/mail-settings",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(result.current.message).toContain("配信フォーマットを上書き保存しました");
  });

  it("handleTestSendは送信先未入力の場合エラーを設定しfetchしない", async () => {
    const fetchSpy = mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useMailSettings());
    await waitFor(() => expect(result.current.currentTemplate).toBeDefined());

    await act(async () => {
      await result.current.handleTestSend({
        preventDefault: () => {},
      } as unknown as React.MouseEvent);
    });

    expect(result.current.error).toBe("テストメールの送信先(To)を入力してください");
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/mail-settings/test-email"),
      expect.anything(),
    );
  });

  it("handleTestSendは送信先入力時、成功メッセージをdata.messageから設定する", async () => {
    mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useMailSettings());
    await waitFor(() => expect(result.current.currentTemplate).toBeDefined());

    act(() => {
      result.current.setTestToEmail("test@example.com");
    });

    await act(async () => {
      await result.current.handleTestSend({
        preventDefault: () => {},
      } as unknown as React.MouseEvent);
    });

    expect(result.current.message).toBe("テストメールを送信しました");
  });

  it("handleFileUploadはlogo/seal種別でPNG以外を拒否し、アップロード欄の結果表示で伝える(BUG-037)", async () => {
    const fetchSpy = mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useMailSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const input = document.createElement("input");
    input.type = "file";
    const file = new File(["dummy"], "logo.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    const event = { target: input } as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileUpload(event, "logo");
    });

    expect(window.alert).not.toHaveBeenCalled();
    expect(result.current.uploadStatuses.logo).toEqual({
      message:
        "❌ 会社ロゴおよび社印は、背景透過処理などが適用可能な PNG 形式 (.png) のみアップロード可能です",
      isError: true,
    });
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/mail-settings/upload-file"),
      expect.anything(),
    );
  });

  it("handleFileUploadは成功時にuploadStatusesへ成功メッセージを設定する", async () => {
    mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useMailSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const input = document.createElement("input");
    input.type = "file";
    const file = new File(["dummy"], "logo.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    const event = { target: input } as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileUpload(event, "logo");
    });

    expect(result.current.uploadStatuses.logo?.isError).toBe(false);
    expect(result.current.uploadStatuses.logo?.message).toContain("会社ロゴ");
  });

  it("handleReportTemplateUploadは.xlsx以外を拒否する", async () => {
    const fetchSpy = mockFetch({ roleId: "admin" });
    const { result } = renderHook(() => useMailSettings());
    await waitFor(() => expect(result.current.activeTab).toBe("quote"));

    const input = document.createElement("input");
    input.type = "file";
    const file = new File(["dummy"], "template.pdf");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    const event = { target: input } as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleReportTemplateUpload(event);
    });

    expect(window.alert).not.toHaveBeenCalled();
    expect(result.current.reportTemplateStatus).toEqual({
      message: "❌ 帳票テンプレートは Excel形式 (.xlsx) のみアップロード可能です",
      isError: true,
    });
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/mail-settings/upload-file"),
      expect.anything(),
    );
  });

  it("handleReportTemplateDeleteは確認ダイアログでキャンセルすると削除しない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchSpy = mockFetch({ roleId: "admin" });
    const templateWithPath = { ...TEMPLATE, reportTemplatePath: "report_templates/quote.xlsx" };
    fetchSpy.mockImplementation(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/auth/profile")) return jsonResponse({ id: "u1", roleId: "admin", permissions: [] });
      if (u.endsWith("/api/mail-settings")) return jsonResponse([templateWithPath]);
      if (u.includes("/api/company-settings")) return jsonResponse({ is_pagination_enabled: false });
      return jsonResponse({});
    });
    const { result } = renderHook(() => useMailSettings());
    await waitFor(() => expect(result.current.currentTemplate?.reportTemplatePath).toBeTruthy());

    await act(async () => {
      await result.current.handleReportTemplateDelete();
    });

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/mail-settings/report-template/"),
      expect.anything(),
    );
  });
});
