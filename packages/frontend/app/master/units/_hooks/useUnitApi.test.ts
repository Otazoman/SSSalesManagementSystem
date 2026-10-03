import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useUnitApi } from "./useUnitApi";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function defaultProps() {
  return {
    canRead: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    permsLoading: false,
  };
}

/** company-settings(is_pagination_enabled) + units一覧 の初期フェッチ2回をまとめて処理する */
function mockInitialFetches(fetchSpy: ReturnType<typeof vi.fn>, units: unknown[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    if (url.toString().includes("/api/company-settings")) {
      return jsonResponse({ is_pagination_enabled: false });
    }
    if (url.toString().includes("/api/units")) {
      return jsonResponse(units);
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

describe("useUnitApi", () => {
  it("初期状態: 会社設定と単位一覧を取得しunitsへ反映する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, [{ code: "PCS", name: "個", status: "active" }]);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useUnitApi(defaultProps()));

    await waitFor(() => expect(result.current.units).toEqual([
      { code: "PCS", name: "個", status: "active" },
    ]));
    expect(result.current.filterStatus).toBe("active");
  });

  it("承認ワークフロー有効時はfilterStatus/statusの初期値がtemporaryになる", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useUnitApi({ ...defaultProps(), isUnitWfEnabled: true }),
    );

    await waitFor(() => expect(result.current.filterStatus).toBe("temporary"));
    expect(result.current.status).toBe("temporary");
  });

  it("承認ワークフロー無効時の新規登録: /api/units/registerへPOSTしメッセージを設定する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useUnitApi(defaultProps()));
    await waitFor(() => expect(result.current.units).toEqual([]));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/units/register")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(init?.body as string)).toEqual({ code: "PCS", name: "個" });
        return jsonResponse({ code: "PCS", name: "個" });
      }
      return jsonResponse([]);
    });

    act(() => {
      result.current.setCode("pcs");
      result.current.setName("個");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(result.current.message).toBe("単位を新規登録しました");
    expect(result.current.error).toBe("");
  });

  it("承認ワークフロー有効時の新規登録: 仮登録POST後にapprovals/request-updateを申請する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useUnitApi({ ...defaultProps(), isUnitWfEnabled: true }),
    );
    await waitFor(() => expect(result.current.filterStatus).toBe("temporary"));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push(url.toString());
      if (url.toString().includes("/api/units/register")) {
        expect(JSON.parse(init?.body as string)).toEqual({
          code: "PCS",
          name: "個",
          status: "temporary",
        });
        return jsonResponse({});
      }
      if (url.toString().includes("/api/approvals/request-update")) {
        const body = JSON.parse(init?.body as string);
        expect(body.targetType).toBe("master_units");
        expect(body.requestType).toBe("REGISTER");
        expect(body.payload).toEqual({ code: "PCS", name: "個", status: "active" });
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    act(() => {
      result.current.setCode("PCS");
      result.current.setName("個");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(calledUrls.some((u) => u.includes("/api/units/register"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/approvals/request-update"))).toBe(true);
    expect(result.current.message).toBe(
      "単位を仮登録し、承認を申請しました(承認待ち)",
    );
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をrequest-updateのペイロードに含める", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const { result } = renderHook(() =>
      useUnitApi({ ...defaultProps(), isUnitWfEnabled: true, departments }),
    );
    await waitFor(() => expect(result.current.filterStatus).toBe("temporary"));

    // 初期値は所属部門の先頭(従来の暗黙動作と同じ)
    expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a");

    act(() => result.current.setApplicantDepartmentSurrogateId("dept-b"));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/approvals/request-update")) {
        const body = JSON.parse(init?.body as string);
        expect(body.applicantDepartmentSurrogateId).toBe("dept-b");
        return jsonResponse({});
      }
      return jsonResponse({});
    });

    act(() => {
      result.current.setCode("PCS");
      result.current.setName("個");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(result.current.message).toBe(
      "単位を仮登録し、承認を申請しました(承認待ち)",
    );
  });

  it("削除確認でキャンセルした場合はDELETEを呼ばない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, [{ code: "PCS", name: "個", status: "active" }]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useUnitApi(defaultProps()));
    await waitFor(() => expect(result.current.units.length).toBe(1));

    await act(async () => {
      await result.current.handleDelete(result.current.units[0]);
    });

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/units/PCS"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("削除確認でOKした場合はDELETEし、成功メッセージを設定する", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, [{ code: "PCS", name: "個", status: "active" }]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useUnitApi(defaultProps()));
    await waitFor(() => expect(result.current.units.length).toBe(1));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/units/PCS") && init?.method === "DELETE") {
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleDelete(result.current.units[0]);
    });

    expect(result.current.message).toBe("単位を削除しました");
  });

  it("無効化(承認ワークフロー無効)は/suspendエンドポイントを呼ぶ", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, [{ code: "PCS", name: "個", status: "active" }]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useUnitApi(defaultProps()));
    await waitFor(() => expect(result.current.units.length).toBe(1));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string) => {
      calledUrls.push(url.toString());
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSuspend(result.current.units[0]);
    });

    expect(calledUrls.some((u) => u.includes("/api/units/PCS/suspend"))).toBe(true);
    expect(result.current.message).toBe("単位を無効化しました");
  });

  it("canRead:falseの場合は一覧をfetchしない", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useUnitApi({ ...defaultProps(), canRead: false }));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/units?"),
      expect.anything(),
    );
  });

  it("handleCancelEditは編集状態をリセットする", async () => {
    const fetchSpy = vi.fn();
    mockInitialFetches(fetchSpy, [{ code: "PCS", name: "個", status: "active" }]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useUnitApi(defaultProps()));
    await waitFor(() => expect(result.current.units.length).toBe(1));

    act(() => {
      result.current.handleStartEdit(result.current.units[0]);
    });
    expect(result.current.editingUnit).toEqual(result.current.units[0]);

    act(() => {
      result.current.handleCancelEdit();
    });
    expect(result.current.editingUnit).toBeNull();
    expect(result.current.code).toBe("");
    expect(result.current.name).toBe("");
  });
});
