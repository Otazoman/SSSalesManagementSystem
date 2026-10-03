import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttachmentUpload } from "./use-attachment-upload";

function makeChangeEvent(file: File | null) {
  const input = document.createElement("input");
  input.type = "file";
  if (file) {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
  }
  return { target: input } as React.ChangeEvent<HTMLInputElement>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAttachmentUpload", () => {
  it("ファイル未選択時はnullを返しuploadingもfalseのまま", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAttachmentUpload({ uploadUrl: "/api/partners/upload" }));

    let ret: unknown;
    await act(async () => {
      ret = await result.current.uploadFile(makeChangeEvent(null), "OTHER");
    });

    expect(ret).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.uploading).toBe(false);
  });

  it("成功時はAttachmentRecord形状を返し、credentials付きでPOSTする", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ fileName: "spec.pdf", attachmentR2Path: "partners/spec.pdf" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useAttachmentUpload({ uploadUrl: "/api/partners/upload" }));
    const event = makeChangeEvent(new File(["dummy"], "spec.pdf"));

    let ret: unknown;
    await act(async () => {
      ret = await result.current.uploadFile(event, "SPEC_SHEET");
    });

    expect(ret).toEqual({
      fileName: "spec.pdf",
      storageType: "R2",
      attachmentR2Path: "partners/spec.pdf",
      fileType: "SPEC_SHEET",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/partners/upload",
      expect.objectContaining({ method: "POST", credentials: "include", body: expect.any(FormData) }),
    );
    expect(event.target.value).toBe("");
    expect(result.current.uploading).toBe(false);
  });

  it("失敗時はonErrorを呼びnullを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAttachmentUpload({ uploadUrl: "/api/partners/upload", onError }),
    );

    let ret: unknown;
    await act(async () => {
      ret = await result.current.uploadFile(makeChangeEvent(new File(["x"], "a.png")), "OTHER");
    });

    expect(ret).toBeNull();
    expect(onError).toHaveBeenCalledWith("アップロードに失敗しました");
  });
});
