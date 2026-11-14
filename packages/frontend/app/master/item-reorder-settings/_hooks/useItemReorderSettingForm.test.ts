import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useItemReorderSettingForm } from "./useItemReorderSettingForm";
import { ItemReorderSettingRecord } from "../_types";

// BUG-098: 承認 ON の発注点/安全在庫の登録・変更は、仮登録 → 申請(単位マスタと同じ二段階方式)
function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
type Call = { url: string; method: string; body: unknown };
function stubFetch(handler: (c: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
      calls.push(call);
      return jsonResponse(handler(call) ?? {});
    }),
  );
  return calls;
}
const submitEvent = { preventDefault: () => {} } as React.FormEvent;
const existing: ItemReorderSettingRecord = {
  id: "RS-1",
  itemId: "ITEM-1",
  itemName: "品目",
  warehouseId: "WH-1",
  warehouseName: "倉庫",
  reorderPoint: 1,
  safetyStock: 2,
  memo: null,
  status: "active",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useItemReorderSettingForm(BUG-098)", () => {
  it("承認 ON の新規登録: 仮登録してから、返った番号で新規登録(REGISTER)を申請する", async () => {
    const calls = stubFetch((c) => (c.url.includes("/register") ? { id: "RS-NEW", status: "temporary" } : {}));
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useItemReorderSettingForm(null, true, true, onSuccess, vi.fn(), { isWfEnabled: true, applicantDepartmentSurrogateId: "dept-a" }),
    );
    act(() => {
      result.current.setItemId("ITEM-1");
      result.current.setWarehouseId("WH-1");
      result.current.setReorderPoint(10);
      result.current.setSafetyStock(20);
    });
    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });
    const request = calls.find((c) => c.url.includes("/api/approvals/request-update"))!;
    expect(request.body).toMatchObject({
      targetType: "master_item_reorder_settings",
      targetId: "RS-NEW",
      requestType: "REGISTER",
      applicantDepartmentSurrogateId: "dept-a",
      payload: { itemId: "ITEM-1", warehouseId: "WH-1", reorderPoint: 10, safetyStock: 20, status: "active" },
    });
    expect(onSuccess).toHaveBeenCalledWith("発注点/安全在庫設定を仮登録し、承認を申請しました(承認待ち)");
  });

  it("承認 ON の変更: 今の内容のまま temporary にロックし、変更後の内容で変更(UPDATE)を申請する", async () => {
    const calls = stubFetch((c) => (c.url.includes("request-status") ? { status: "APPROVED" } : {}));
    const { result } = renderHook(() =>
      useItemReorderSettingForm(existing, true, true, vi.fn(), vi.fn(), { isWfEnabled: true }),
    );
    await waitFor(() => expect(result.current.reorderPoint).toBe(1));
    act(() => result.current.setReorderPoint(30));
    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ reorderPoint: 1, status: "temporary" });
    const request = calls.find((c) => c.url.includes("/api/approvals/request-update"))!;
    expect(request.body).toMatchObject({ requestType: "UPDATE", targetId: "RS-1", payload: { reorderPoint: 30 } });
  });

  it("承認待ち(PENDING)の仮登録は編集できない", async () => {
    const calls = stubFetch((c) => (c.url.includes("request-status") ? { status: "PENDING" } : {}));
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useItemReorderSettingForm({ ...existing, status: "temporary" }, true, true, vi.fn(), onError, { isWfEnabled: true }),
    );
    await waitFor(() => expect(result.current.isLocked).toBe(true));
    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });
    expect(onError).toHaveBeenCalledWith("承認待ちのため変更できません");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
