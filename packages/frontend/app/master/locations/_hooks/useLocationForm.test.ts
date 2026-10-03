import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocationForm } from "./useLocationForm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function fillForm(result: ReturnType<typeof useLocationForm>) {
  act(() => {
    result.setLocId("LOC-A-01");
    result.setLocWarehouseId("WH-1");
    result.setLocName("A棚1段目");
  });
}

describe("useLocationForm", () => {
  it("登録権限が無い場合はfetchせずfalseを返す", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useLocationForm({ canCreate: false, canUpdate: true, onSuccess: vi.fn(), onError }),
    );

    let ret: boolean | undefined;
    await act(async () => {
      ret = await result.current.handleSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(ret).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("登録する権限がありません");
  });

  it("承認ワークフロー無効の新規登録: /api/locations/registerへPOSTしonSuccessを呼ぶ", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useLocationForm({ canCreate: true, canUpdate: true, onSuccess, onError: vi.fn() }),
    );
    fillForm(result.current);

    let ret: boolean | undefined;
    await act(async () => {
      ret = await result.current.handleSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(ret).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/locations/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onSuccess).toHaveBeenCalledWith("ロケーションを新規登録しました");
  });

  it("承認ワークフロー有効の新規登録: 仮登録POST後にrequest-updateをREGISTERで申請する", async () => {
    const calledUrls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calledUrls.push({ url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : null });
        return jsonResponse({});
      }),
    );
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useLocationForm({
        canCreate: true,
        canUpdate: true,
        isLocationWfEnabled: true,
        onSuccess,
        onError: vi.fn(),
      }),
    );
    fillForm(result.current);

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    const preSave = calledUrls.find((c) => c.url === "/api/locations/register");
    expect((preSave!.body as { status: string }).status).toBe("temporary");
    const request = calledUrls.find((c) => c.url === "/api/approvals/request-update");
    expect((request!.body as { requestType: string; targetType: string }).requestType).toBe(
      "REGISTER",
    );
    expect((request!.body as { targetType: string }).targetType).toBe("master_locations");
    expect(onSuccess).toHaveBeenCalledWith(
      "ロケーションを仮登録し、承認を申請しました(承認待ち)",
    );
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をrequest-updateのペイロードに含める", async () => {
    const calledUrls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calledUrls.push({ url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : null });
        return jsonResponse({});
      }),
    );
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const { result } = renderHook(() =>
      useLocationForm({
        canCreate: true,
        canUpdate: true,
        isLocationWfEnabled: true,
        departments,
        onSuccess: vi.fn(),
        onError: vi.fn(),
      }),
    );
    expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a");
    act(() => result.current.setApplicantDepartmentSurrogateId("dept-b"));
    fillForm(result.current);

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    const request = calledUrls.find((c) => c.url === "/api/approvals/request-update");
    expect(
      (request!.body as { applicantDepartmentSurrogateId: string }).applicantDepartmentSurrogateId,
    ).toBe("dept-b");
  });

  it("失敗時はonErrorへメッセージを渡しfalseを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "コードが重複しています" }, 400)),
    );
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useLocationForm({ canCreate: true, canUpdate: true, onSuccess: vi.fn(), onError }),
    );
    fillForm(result.current);

    let ret: boolean | undefined;
    await act(async () => {
      ret = await result.current.handleSubmit({
        preventDefault: () => {},
      } as React.SyntheticEvent);
    });

    expect(ret).toBe(false);
    expect(onError).toHaveBeenCalledWith("コードが重複しています");
  });

  it("selectLocationForEditは既存レコードの値をフォームへ反映する", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "PENDING" })));
    const { result } = renderHook(() =>
      useLocationForm({ canCreate: true, canUpdate: true, onSuccess: vi.fn(), onError: vi.fn() }),
    );

    act(() => {
      result.current.selectLocationForEdit({
        id: "LOC-A-01",
        warehouseId: "WH-1",
        name: "A棚",
        memo: "メモ",
        status: "active",
      });
    });

    expect(result.current.editingId).toBe("LOC-A-01");
    expect(result.current.locName).toBe("A棚");
  });

  it("resetFormは編集状態をクリアする", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() =>
      useLocationForm({ canCreate: true, canUpdate: true, onSuccess: vi.fn(), onError: vi.fn() }),
    );
    fillForm(result.current);

    act(() => {
      result.current.resetForm();
    });

    expect(result.current.locId).toBe("");
    expect(result.current.locName).toBe("");
  });
});
