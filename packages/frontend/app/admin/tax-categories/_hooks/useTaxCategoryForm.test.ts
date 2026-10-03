import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaxCategoryForm } from "./useTaxCategoryForm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTaxCategoryForm", () => {
  it("initialData指定時は各フィールドへ反映する", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() =>
      useTaxCategoryForm(
        { code: "TAX_10", name: "10%標準税率", taxType: "STANDARD", taxRate: 0.1, validFrom: null, validTo: null },
        true,
        true,
        vi.fn(),
        vi.fn(),
      ),
    );

    expect(result.current.code).toBe("TAX_10");
    expect(result.current.taxRate).toBe(0.1);
  });

  it("initialData:nullの場合はデフォルト値(STANDARD/0.1)にリセットする", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useTaxCategoryForm(null, true, true, vi.fn(), vi.fn()));

    expect(result.current.code).toBe("");
    expect(result.current.taxType).toBe("STANDARD");
    expect(result.current.taxRate).toBe(0.1);
  });

  it("新規登録時に権限が無い場合はfetchせずonErrorを呼ぶ", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onError = vi.fn();
    const { result } = renderHook(() => useTaxCategoryForm(null, false, true, vi.fn(), onError));

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("この操作をする権限がありません");
  });

  it("編集時に更新権限が無い場合はfetchせずonErrorを呼ぶ", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useTaxCategoryForm(
        { code: "TAX_10", name: "税", taxType: "STANDARD", taxRate: 0.1, validFrom: null, validTo: null },
        true,
        false,
        vi.fn(),
        onError,
      ),
    );

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("この操作をする権限がありません");
  });

  it("新規登録はPOSTし、onSuccessを呼ぶ", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useTaxCategoryForm(null, true, true, onSuccess, vi.fn()));

    act(() => {
      result.current.setCode("TAX_08");
      result.current.setName("軽減税率8%");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tax-categories/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onSuccess).toHaveBeenCalledWith("消費税区分を保存しました");
  });

  it("編集時はPUTする", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useTaxCategoryForm(
        { code: "TAX_10", name: "税", taxType: "STANDARD", taxRate: 0.1, validFrom: null, validTo: null },
        true,
        true,
        vi.fn(),
        vi.fn(),
      ),
    );

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/tax-categories",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("失敗時はonErrorへメッセージを渡す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "コードが重複しています" }, 400)),
    );
    const onError = vi.fn();
    const { result } = renderHook(() => useTaxCategoryForm(null, true, true, vi.fn(), onError));

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    });

    expect(onError).toHaveBeenCalledWith("コードが重複しています");
  });
});
