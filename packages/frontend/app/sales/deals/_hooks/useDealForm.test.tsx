import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { useDealForm } from "./useDealForm";
import { PermissionProvider } from "../../../context/permissioncontext";

// BUG-096: 新規登録の商談担当(自社)の初期値はログイン中のユーザー
function wrapper({ children }: { children: ReactNode }) {
  const user = { employeeNumber: "E123", roleId: "staff", permissions: [] } as never;
  return <PermissionProvider value={{ user, flatScreens: [], loading: false }}>{children}</PermissionProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDealForm(BUG-096)", () => {
  it("新規登録を開くと、商談担当(自社)にログイン中のユーザーの従業員番号が入る", () => {
    const { result } = renderHook(() => useDealForm(async () => {}), { wrapper });
    act(() => result.current.openNew());
    expect(result.current.form.ownerEmployeeNumber).toBe("E123");
  });

  it("ログイン情報が無ければ空欄のまま", () => {
    const { result } = renderHook(() => useDealForm(async () => {}));
    act(() => result.current.openNew());
    expect(result.current.form.ownerEmployeeNumber).toBe("");
  });
});
