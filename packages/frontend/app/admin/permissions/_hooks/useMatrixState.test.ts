import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useMatrixState } from "./useMatrixState";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const screens = [{ resource: "master_units", name: "単位マスタ", category: "master" }];
const permissions = [
  { id: "master_units:menu", resource: "master_units", action: "menu", name: "単位マスタ [メニュー表示]", description: null },
  { id: "master_units:read", resource: "master_units", action: "read", name: "単位マスタ [閲覧 (R)]", description: null },
  { id: "master_units:create", resource: "master_units", action: "create", name: "単位マスタ [登録 (C)]", description: null },
  { id: "master_units:update", resource: "master_units", action: "update", name: "単位マスタ [編集 (U)]", description: null },
  { id: "master_units:delete", resource: "master_units", action: "delete", name: "単位マスタ [削除 (D)]", description: null },
];
const roles = [
  { id: "admin", name: "管理者" },
  { id: "general_user", name: "一般ユーザー" },
];

function mockBaseFetches(fetchSpy: ReturnType<typeof vi.fn>) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/permissions/screens")) return jsonResponse(screens);
    if (u.includes("/api/permissions/role/")) return jsonResponse(["master_units:read"]);
    if (u.includes("/api/roles")) return jsonResponse(roles);
    if (u.includes("/api/permissions")) return jsonResponse(permissions);
    return jsonResponse({});
  });
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMatrixState", () => {
  it("初期化: permissions/roles/screenOptionsを取得し、admin以外の最初のロールを自動選択する", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );

    await waitFor(() => expect(result.current.roles.length).toBe(2));
    expect(result.current.selectedRoleId).toBe("general_user");
  });

  it("選択ロールの権限をfetchしcheckedPermissionIdsへ反映する", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );

    await waitFor(() =>
      expect(result.current.checkedPermissionIds).toEqual(["master_units:read"]),
    );
  });

  it("handleMatrixCheckChange: チェック済みIDを追加・削除する(canUpdate:falseの場合は無視)", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: false, loading: false }),
    );
    await waitFor(() => expect(result.current.checkedPermissionIds.length).toBe(1));

    act(() => result.current.handleMatrixCheckChange("master_units:create"));
    expect(result.current.checkedPermissionIds).toEqual(["master_units:read"]);
  });

  it("handleMatrixCheckChange: canUpdate:trueの場合は追加・削除される", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );
    await waitFor(() => expect(result.current.checkedPermissionIds.length).toBe(1));

    act(() => result.current.handleMatrixCheckChange("master_units:create"));
    expect(result.current.checkedPermissionIds).toEqual(
      expect.arrayContaining(["master_units:read", "master_units:create"]),
    );

    act(() => result.current.handleMatrixCheckChange("master_units:read"));
    expect(result.current.checkedPermissionIds).toEqual(["master_units:create"]);
  });

  it("handleToggleColumnCheckboxes: 列が一部のみONの場合は全ONにする", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );
    // "read"列はmockBaseFetchesの/api/permissions/role/応答で最初からON済みのため、
    // まだONでない"create"列を使って「一部(0件)ONから全ONへ」を検証する
    await waitFor(() => expect(result.current.checkedPermissionIds).toEqual(["master_units:read"]));

    act(() => result.current.handleToggleColumnCheckboxes("create"));
    expect(result.current.checkedPermissionIds).toContain("master_units:create");
  });

  it("handleToggleColumnCheckboxes: 列が全ONの場合は全OFFにする", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );
    await waitFor(() => expect(result.current.checkedPermissionIds).toContain("master_units:read"));

    act(() => result.current.handleToggleColumnCheckboxes("read"));
    expect(result.current.checkedPermissionIds).not.toContain("master_units:read");
  });

  it("handleToggleRowCheckboxes: 行が一部のみONの場合は全ONにする", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );
    await waitFor(() => expect(result.current.checkedPermissionIds).toEqual(["master_units:read"]));

    act(() => result.current.handleToggleRowCheckboxes("master_units"));
    expect(result.current.checkedPermissionIds).toEqual(
      expect.arrayContaining([
        "master_units:menu",
        "master_units:read",
        "master_units:create",
        "master_units:update",
        "master_units:delete",
      ]),
    );
  });

  it("handleToggleRowCheckboxes: 行が全ONの場合は全OFFにする", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );
    await waitFor(() => expect(result.current.checkedPermissionIds).toEqual(["master_units:read"]));

    act(() => result.current.handleToggleRowCheckboxes("master_units"));
    expect(result.current.checkedPermissionIds.length).toBe(5);

    act(() => result.current.handleToggleRowCheckboxes("master_units"));
    expect(result.current.checkedPermissionIds).toEqual([]);
  });

  it("handleToggleRowCheckboxes: canUpdate:falseの場合は無視する", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: false, loading: false }),
    );
    await waitFor(() => expect(result.current.checkedPermissionIds).toEqual(["master_units:read"]));

    act(() => result.current.handleToggleRowCheckboxes("master_units"));
    expect(result.current.checkedPermissionIds).toEqual(["master_units:read"]);
  });

  it("handleSaveRoleMapping: PUTしメッセージを設定する", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );
    await waitFor(() => expect(result.current.selectedRoleId).toBe("general_user"));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/permissions/role/general_user") && init?.method === "PUT") {
        expect(JSON.parse(init.body as string)).toEqual({ permissionIds: ["master_units:read"] });
        return jsonResponse({});
      }
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSaveRoleMapping();
    });

    expect(result.current.message).toContain("一般ユーザー");
    expect(result.current.isSaving).toBe(false);
  });

  it("handleSaveRoleMapping: canUpdate:falseの場合はAPIを叩かずerrorを設定する", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: false, loading: false }),
    );
    await waitFor(() => expect(result.current.selectedRoleId).toBe("general_user"));
    fetchSpy.mockClear();

    await act(async () => {
      await result.current.handleSaveRoleMapping();
    });

    expect(result.current.error).toBe("権限マトリクスを保存する権限がありません");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handleCopyAsTemplate/handlePasteTemplate: コピーした内容を別ロール選択後に貼り付けられる", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );
    await waitFor(() => expect(result.current.checkedPermissionIds).toEqual(["master_units:read"]));

    act(() => result.current.handleCopyAsTemplate());
    expect(result.current.hasCopiedTemplate).toBe(true);
    expect(result.current.copiedRoleName).toBe("一般ユーザー");

    act(() => result.current.handleMatrixCheckChange("master_units:read"));
    expect(result.current.checkedPermissionIds).toEqual([]);

    act(() => result.current.handlePasteTemplate());
    expect(result.current.checkedPermissionIds).toEqual(["master_units:read"]);
  });

  it("importCsv: canCreate:falseの場合はerrorを設定しAPIを叩かない", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: false, canUpdate: true, loading: false }),
    );
    await waitFor(() => expect(result.current.permissions.length).toBe(5));
    fetchSpy.mockClear();

    await act(async () => {
      await result.current.importCsv(new File(["role_id,permission_id"], "matrix.csv"));
    });

    expect(result.current.error).toBe("CSVインポートを実行する権限がありません");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("importCsv: multipart/form-dataでPOSTし、成功メッセージを反映する", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const { result } = renderHook(() =>
      useMatrixState({ canRead: true, canCreate: true, canUpdate: true, loading: false }),
    );
    await waitFor(() => expect(result.current.permissions.length).toBe(5));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/permissions/bulk-register")) {
        expect(init?.body).toBeInstanceOf(FormData);
        return jsonResponse({ message: "2件取り込みました" });
      }
      return jsonResponse(permissions);
    });

    await act(async () => {
      await result.current.importCsv(new File(["role_id,permission_id"], "matrix.csv"));
    });

    expect(result.current.message).toBe("2件取り込みました");
  });
});
