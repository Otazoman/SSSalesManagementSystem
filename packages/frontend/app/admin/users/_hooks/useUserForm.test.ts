import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUserForm } from "./useUserForm";
import { UserRecord } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const existingUser: UserRecord = {
  id: "u1",
  employeeNumber: "EMP001",
  name: "山田 太郎",
  email: "yamada@example.com",
  isActive: true,
  relations: [
    { departmentId: "d1", departmentName: "開発部", roleId: "general_user", roleName: "一般" },
  ],
};

function baseProps(overrides: Partial<Parameters<typeof useUserForm>[0]> = {}) {
  return {
    editingUserId: null,
    users: [existingUser],
    hasCreate: true,
    hasUpdate: true,
    hasFormPermission: true,
    onSuccess: vi.fn(),
    setError: vi.fn(),
    setMessage: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useUserForm", () => {
  it("editingUserId未指定時はフォーム状態が空初期値になる", () => {
    const props = baseProps();
    const { result } = renderHook(() => useUserForm(props));
    expect(result.current.empNum).toBe("");
    expect(result.current.formRelations).toEqual([{ departmentId: "", roleId: "" }]);
  });

  it("editingUserId指定時は対象ユーザーの値をフォームへ反映する", () => {
    const props = baseProps({ editingUserId: "u1" });
    const { result } = renderHook(() => useUserForm(props));
    expect(result.current.empNum).toBe("EMP001");
    expect(result.current.userName).toBe("山田 太郎");
    expect(result.current.formRelations).toEqual([{ departmentId: "d1", roleId: "general_user" }]);
  });

  it("addRelationRow/removeRelationRowで行を増減する", () => {
    const props = baseProps();
    const { result } = renderHook(() => useUserForm(props));

    act(() => result.current.addRelationRow());
    expect(result.current.formRelations.length).toBe(2);

    act(() => result.current.removeRelationRow(0));
    expect(result.current.formRelations.length).toBe(1);
  });

  it("hasFormPermission:falseの場合はaddRelationRow/updateRelationRowが効かない", () => {
    const props = baseProps({ hasFormPermission: false });
    const { result } = renderHook(() => useUserForm(props));

    act(() => result.current.addRelationRow());
    expect(result.current.formRelations.length).toBe(1);

    act(() => result.current.updateRelationRow(0, "roleId", "admin"));
    expect(result.current.formRelations[0].roleId).toBe("");
  });

  it("roleIdをadminに変更するとdepartmentIdが自動的にクリアされる", () => {
    const props = baseProps();
    const { result } = renderHook(() => useUserForm(props));

    act(() => result.current.updateRelationRow(0, "departmentId", "d1"));
    expect(result.current.formRelations[0].departmentId).toBe("d1");

    act(() => result.current.updateRelationRow(0, "roleId", "admin"));
    expect(result.current.formRelations[0]).toEqual({ departmentId: "", roleId: "admin" });
  });

  it("roleId未設定の行がある場合は送信をブロックしてsetErrorを呼ぶ", async () => {
    const props = baseProps();
    const { result } = renderHook(() => useUserForm(props));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      await result.current.handleUserSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(props.setError).toHaveBeenCalledWith(
      "⚠️ 追加したすべての行に「権限」を必ず設定してください",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("新規登録: POST /api/users/registerへemployeeNumber付きで送信する", async () => {
    const props = baseProps();
    const { result } = renderHook(() => useUserForm(props));
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/users/register");
      const body = JSON.parse(init?.body as string);
      expect(body.employeeNumber).toBe("EMP999");
      expect(body.relations).toEqual([{ departmentId: "d1", roleId: "general_user" }]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    act(() => {
      result.current.setEmpNum("EMP999");
      result.current.setUserName("新規太郎");
      result.current.setUserEmail("new@example.com");
    });
    // 実際のUIでは各onChangeが個別のイベントとして処理され、その都度再レンダーされるため、
    // 同一formRelations行への連続更新はact()を分けて呼び、都度最新stateを反映させる
    act(() => result.current.updateRelationRow(0, "departmentId", "d1"));
    act(() => result.current.updateRelationRow(0, "roleId", "general_user"));

    await act(async () => {
      await result.current.handleUserSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(props.setMessage).toHaveBeenCalledWith("新規ユーザーを登録しました");
    expect(props.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("編集: PUT /api/users/:idへ既存isActiveを引き継いで送信する", async () => {
    const props = baseProps({ editingUserId: "u1" });
    const { result } = renderHook(() => useUserForm(props));
    await waitFor(() => expect(result.current.userName).toBe("山田 太郎"));

    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/users/u1");
      expect(init?.method).toBe("PUT");
      const body = JSON.parse(init?.body as string);
      expect(body.isActive).toBe(true);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      await result.current.handleUserSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(props.setMessage).toHaveBeenCalledWith("ユーザーマスタを更新しました");
  });

  it("編集時にhasUpdate:falseの場合は送信せずsetErrorを呼ぶ", async () => {
    const props = baseProps({ editingUserId: "u1", hasUpdate: false });
    const { result } = renderHook(() => useUserForm(props));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      await result.current.handleUserSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(props.setError).toHaveBeenCalledWith("⚠️ 更新する権限がありません");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("失敗時はerrメッセージをsetErrorへ渡す", async () => {
    const props = baseProps();
    const { result } = renderHook(() => useUserForm(props));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "メールアドレスが重複しています" }, 400)),
    );

    act(() => {
      result.current.setUserName("A");
      result.current.setUserEmail("a@example.com");
      result.current.updateRelationRow(0, "roleId", "general_user");
    });

    await act(async () => {
      await result.current.handleUserSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(props.setError).toHaveBeenCalledWith("メールアドレスが重複しています");
  });
});
