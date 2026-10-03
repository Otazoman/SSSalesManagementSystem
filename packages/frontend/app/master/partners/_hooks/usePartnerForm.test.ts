import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePartnerForm, initialFormState } from "./usePartnerForm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePartnerForm", () => {
  it("初期状態はinitialFormStateと一致する", () => {
    const { result } = renderHook(() =>
      usePartnerForm(null, false, true, true, vi.fn(), vi.fn()),
    );
    expect(result.current.formData).toEqual(initialFormState);
  });

  it("承認機能無効の新規登録: /api/partners/registerへPOSTしonSuccess/onCloseを呼ぶ", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      usePartnerForm(null, false, true, true, onSuccess, onClose),
    );

    act(() => {
      result.current.handleInputChange("id", "CUST-001");
      result.current.handleInputChange("name", "株式会社テスト");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/partners/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onSuccess).toHaveBeenCalledWith("取引先を新規登録しました");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("承認機能有効の新規登録: 仮登録POST後にapprovals/request-updateを申請する", async () => {
    const calledUrls: string[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      calledUrls.push(url.toString());
      if (url.toString().includes("/api/partners/register")) {
        expect(JSON.parse(init?.body as string)).toMatchObject({ status: "temporary" });
      }
      if (url.toString().includes("/api/approvals/request-update")) {
        const body = JSON.parse(init?.body as string);
        expect(body.targetType).toBe("master_partners");
        expect(body.requestType).toBe("REGISTER");
        expect(body.payload.status).toBe("active");
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      usePartnerForm(null, true, true, true, onSuccess, vi.fn()),
    );

    act(() => {
      result.current.handleInputChange("id", "CUST-001");
      result.current.handleInputChange("name", "株式会社テスト");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(calledUrls.some((u) => u.includes("/api/partners/register"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/approvals/request-update"))).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith(
      "取引先を新規登録しました",
    );
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をrequest-updateのペイロードに含める", async () => {
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const calledUrls: { url: string; body: any }[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      calledUrls.push({
        url: url.toString(),
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      usePartnerForm(null, true, true, true, vi.fn(), vi.fn(), departments),
    );
    expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a");
    act(() => result.current.setApplicantDepartmentSurrogateId("dept-b"));

    act(() => {
      result.current.handleInputChange("id", "CUST-001");
      result.current.handleInputChange("name", "株式会社テスト");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    const request = calledUrls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request!.body.applicantDepartmentSurrogateId).toBe("dept-b");
  });

  it("回帰: コード自動採番(id空欄)時、仮登録レスポンスのidをrequest-updateのtargetIdに使う", async () => {
    const calledUrls: { url: string; body: any }[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      calledUrls.push({
        url: url.toString(),
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      if (url.toString().includes("/api/partners/register")) {
        return jsonResponse({ id: "CUST-AUTO-1" });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      usePartnerForm(null, true, true, true, vi.fn(), vi.fn()),
    );

    // idは未入力のまま(自動採番依頼)
    act(() => {
      result.current.handleInputChange("name", "株式会社テスト");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    const request = calledUrls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request!.body.targetId).toBe("CUST-AUTO-1");
    expect(request!.body.payload.id).toBe("CUST-AUTO-1");
  });

  it("承認機能有効の編集申請では成功メッセージがロック文言になる", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      usePartnerForm("CUST-001", true, true, true, onSuccess, vi.fn()),
    );

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(onSuccess).toHaveBeenCalledWith(
      "マスタの変更承認をワークフローへ申請しました(承認待ちロック)",
    );
  });

  it("canCreate:falseの新規登録ではhandleSubmitが何もしない", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      usePartnerForm(null, false, false, true, vi.fn(), vi.fn()),
    );

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("送信失敗時はerrorへメッセージを設定する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "コードが重複しています" }, 400)),
    );
    const { result } = renderHook(() =>
      usePartnerForm(null, false, true, true, vi.fn(), vi.fn()),
    );

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(result.current.error).toBe("コードが重複しています");
  });

  it("編集中かつ承認ワークフロー有効な場合、request-statusを取得してisMasterCurrentlyLockedを判定する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "PENDING" })),
    );
    const { result } = renderHook(() =>
      usePartnerForm("CUST-001", true, true, true, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setFormData((prev) => ({ ...prev, status: "temporary" }));
    });

    await waitFor(() => expect(result.current.isMasterCurrentlyLocked).toBe(true));
  });

  it("handleAddExternalLinkはURL/タイトル未入力の場合は追加しない", () => {
    const { result } = renderHook(() =>
      usePartnerForm(null, false, true, true, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.handleAddExternalLink();
    });

    expect(result.current.formData.attachments).toHaveLength(0);
  });

  it("handleAddExternalLinkは入力があればEXTERNAL_LINK添付を追加しinputをクリアする", () => {
    const { result } = renderHook(() =>
      usePartnerForm(null, false, true, true, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setExtUrlInput("https://example.com/spec.pdf");
      result.current.setExtTitleInput("仕様書");
    });
    act(() => {
      result.current.handleAddExternalLink();
    });

    expect(result.current.formData.attachments).toEqual([
      {
        fileName: "仕様書",
        storageType: "EXTERNAL_LINK",
        externalUrl: "https://example.com/spec.pdf",
        fileType: "OTHER",
      },
    ]);
    expect(result.current.extUrlInput).toBe("");
    expect(result.current.extTitleInput).toBe("");
  });

  it("handleRemoveAttachmentは指定indexの添付を除去する", () => {
    const { result } = renderHook(() =>
      usePartnerForm(null, false, true, true, vi.fn(), vi.fn()),
    );

    act(() => {
      result.current.setFormData((prev) => ({
        ...prev,
        attachments: [
          { fileName: "a.pdf", storageType: "R2", attachmentR2Path: "a", fileType: "OTHER" },
          { fileName: "b.pdf", storageType: "R2", attachmentR2Path: "b", fileType: "OTHER" },
        ],
      }));
    });

    act(() => {
      result.current.handleRemoveAttachment(0);
    });

    expect(result.current.formData.attachments).toHaveLength(1);
    expect(result.current.formData.attachments[0].fileName).toBe("b.pdf");
  });
});
