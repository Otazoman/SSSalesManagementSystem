import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWarehouseForm } from "./useWarehouseForm";
import { WarehouseRecord } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function defaultProps() {
  return { canCreate: true, canUpdate: true, onSuccess: vi.fn(), onError: vi.fn() };
}

const existingWarehouse: WarehouseRecord = {
  id: "WH-1",
  name: "本社倉庫",
  warehouseType: "INTERNAL",
  postalCode: "100-0001",
  address: "東京都千代田区",
  phoneNumber: "03-1111-2222",
  faxNumber: null,
  email: null,
  businessStartTime: "09:00",
  businessEndTime: "18:00",
  storageRestrictions: null,
  status: "active",
  memo: null,
  availableDays: [{ availabledayOfWeek: "MON", timeSlotMemo: null }],
  attachments: [],
};

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWarehouseForm", () => {
  it("selectWarehouseForEditは既存レコードの値・受付曜日をフォームへ反映する", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "APPROVED" })));
    const { result } = renderHook(() => useWarehouseForm(defaultProps()));

    act(() => {
      result.current.selectWarehouseForEdit(existingWarehouse);
    });

    expect(result.current.editingId).toBe("WH-1");
    expect(result.current.formData.name).toBe("本社倉庫");
    expect(result.current.formData.availableDays.MON.checked).toBe(true);
    expect(result.current.formData.availableDays.TUE.checked).toBe(false);
  });

  it("handleDayCheckChange/handleDayMemoChangeは該当曜日のみ更新する", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useWarehouseForm(defaultProps()));

    act(() => {
      result.current.handleDayCheckChange("TUE", true);
      result.current.handleDayMemoChange("TUE", "午前のみ");
    });

    expect(result.current.formData.availableDays.TUE).toEqual({ checked: true, memo: "午前のみ" });
    expect(result.current.formData.availableDays.MON.checked).toBe(false);
  });

  it("handleAddExternalLinkはhttps://を自動補完し、attachmentsへEXTERNAL_LINKを追加する", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useWarehouseForm(defaultProps()));

    act(() => {
      result.current.setExtUrlInput("example.com/doc");
      result.current.setExtNameInput("案内資料");
    });
    act(() => {
      result.current.handleAddExternalLink();
    });

    expect(result.current.formData.attachments).toEqual([
      {
        fileName: "案内資料",
        storageType: "EXTERNAL_LINK",
        externalUrl: "https://example.com/doc",
        fileType: "OTHER",
      },
    ]);
    expect(result.current.extUrlInput).toBe("");
  });

  it("URL/名称いずれか未入力の場合はhandleAddExternalLinkが何もしない", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useWarehouseForm(defaultProps()));

    act(() => {
      result.current.setExtUrlInput("example.com");
    });
    act(() => {
      result.current.handleAddExternalLink();
    });

    expect(result.current.formData.attachments).toEqual([]);
  });

  it("handleRemoveAttachmentは指定indexのみ取り除く", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useWarehouseForm(defaultProps()));

    act(() => {
      result.current.setFormData((prev) => ({
        ...prev,
        attachments: [
          { fileName: "a", storageType: "R2", attachmentR2Path: "a", fileType: "OTHER" },
          { fileName: "b", storageType: "R2", attachmentR2Path: "b", fileType: "OTHER" },
        ],
      }));
    });
    act(() => {
      result.current.handleRemoveAttachment(0);
    });

    expect(result.current.formData.attachments).toEqual([
      { fileName: "b", storageType: "R2", attachmentR2Path: "b", fileType: "OTHER" },
    ]);
  });

  it("承認ワークフロー無効の新規登録: /api/warehouses/registerへPOSTしonSuccessを呼ぶ", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchSpy);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useWarehouseForm({ ...defaultProps(), onSuccess }));

    act(() => {
      result.current.handleInputChange("id", "WH-2");
      result.current.handleInputChange("name", "新倉庫");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/warehouses/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onSuccess).toHaveBeenCalledWith("倉庫情報を新規登録しました");
  });

  it("承認ワークフロー有効の変更: 仮登録PUT後にrequest-updateをUPDATEで申請する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "APPROVED" })));
    const { result } = renderHook(() =>
      useWarehouseForm({ ...defaultProps(), isWarehouseWfEnabled: true }),
    );
    act(() => {
      result.current.selectWarehouseForEdit(existingWarehouse);
    });

    const calledUrls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calledUrls.push({ url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : null });
        return jsonResponse({});
      }),
    );

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    const preSave = calledUrls.find((c) => c.url === "/api/warehouses/WH-1");
    expect((preSave!.body as { status: string }).status).toBe("temporary");
    const request = calledUrls.find((c) => c.url === "/api/approvals/request-update");
    expect((request!.body as { requestType: string; targetType: string }).requestType).toBe(
      "UPDATE",
    );
    expect((request!.body as { targetType: string }).targetType).toBe("master_warehouses");
  });

  it("回帰: コード自動採番(id空欄)時、仮登録レスポンスのidをrequest-updateのtargetIdに使う", async () => {
    const calledUrls: { url: string; body: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calledUrls.push({
          url: url.toString(),
          body: init?.body ? JSON.parse(init.body as string) : null,
        });
        if (url.toString().includes("/api/warehouses/register")) {
          return jsonResponse({ id: "WH-AUTO-1" });
        }
        return jsonResponse({});
      }),
    );
    const { result } = renderHook(() =>
      useWarehouseForm({ ...defaultProps(), isWarehouseWfEnabled: true }),
    );

    // idは未入力のまま(自動採番依頼)
    act(() => {
      result.current.handleInputChange("name", "新倉庫");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    const request = calledUrls.find((c) => c.url === "/api/approvals/request-update");
    expect(request!.body.targetId).toBe("WH-AUTO-1");
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をrequest-updateのペイロードに含める", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "APPROVED" })));
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const { result } = renderHook(() =>
      useWarehouseForm({ ...defaultProps(), isWarehouseWfEnabled: true, departments }),
    );
    expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a");
    act(() => result.current.setApplicantDepartmentSurrogateId("dept-b"));
    act(() => {
      result.current.selectWarehouseForEdit(existingWarehouse);
    });

    const calledUrls: { url: string; body: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calledUrls.push({
          url: url.toString(),
          body: init?.body ? JSON.parse(init.body as string) : null,
        });
        return jsonResponse({});
      }),
    );

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    const request = calledUrls.find((c) => c.url === "/api/approvals/request-update");
    expect(request!.body.applicantDepartmentSurrogateId).toBe("dept-b");
  });

  it("無効化(承認ワークフロー無効)は/suspendエンドポイントを呼ぶ", async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calledUrls.push(url.toString());
        return jsonResponse({});
      }),
    );
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useWarehouseForm({ ...defaultProps(), onSuccess }));

    await act(async () => {
      await result.current.handleSuspend(existingWarehouse);
    });

    expect(calledUrls.some((u) => u.includes("/api/warehouses/WH-1/suspend"))).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith("倉庫を無効化しました");
  });

  it("無効化確認でキャンセルした場合はfetchしない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useWarehouseForm(defaultProps()));

    await act(async () => {
      await result.current.handleSuspend(existingWarehouse);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handleCloseFormはフォーム状態を初期値に戻す", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "APPROVED" })));
    const onClose = vi.fn();
    const { result } = renderHook(() => useWarehouseForm({ ...defaultProps(), onClose }));

    act(() => {
      result.current.selectWarehouseForEdit(existingWarehouse);
    });
    act(() => {
      result.current.handleCloseForm();
    });

    expect(result.current.editingId).toBeNull();
    expect(result.current.formData.name).toBe("");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
