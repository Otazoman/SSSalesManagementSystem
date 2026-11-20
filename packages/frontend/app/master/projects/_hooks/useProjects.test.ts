import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProjects } from "./useProjects";

// BUG-097: 承認 ON のプロジェクトの登録・変更は、仮登録 → 申請(単位マスタと同じ二段階方式)
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Call = { url: string; method: string; body: unknown };
function stubFetch(handler: (call: Call) => unknown = () => ({})) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
      calls.push(call);
      return jsonResponse(handler(call) ?? []);
    }),
  );
  return calls;
}

const base = { canRead: true, canCreate: true, canUpdate: true, canDelete: true, loading: false };
const departments = [{ surrogateId: "dept-a", id: "D-A", name: "購買部" }];
const form = { id: "", name: "新PJ", memo: "", startDate: "2026-04-01", endDate: "" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useProjects(BUG-097)", () => {
  it("承認 ON の新規登録: 仮登録してから、採番されたコードで新規登録(REGISTER)を申請する", async () => {
    const calls = stubFetch((c) => (c.url.includes("/api/projects/register") ? { id: "PJ0001", status: "temporary" } : []));
    const { result } = renderHook(() => useProjects({ ...base, isProjectWfEnabled: true, departments }));
    await waitFor(() => expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a"));

    let ok = false;
    await act(async () => {
      ok = await result.current.handleSubmit(form);
    });
    expect(ok).toBe(true);
    const register = calls.find((c) => c.url.includes("/api/projects/register"))!;
    expect(register.body).toMatchObject({ name: "新PJ", startDate: "2026-04-01" });
    const request = calls.find((c) => c.url.includes("/api/approvals/request-update"))!;
    expect(request.body).toMatchObject({
      targetType: "master_projects",
      targetId: "PJ0001",
      requestType: "REGISTER",
      applicantDepartmentSurrogateId: "dept-a",
      payload: { id: "PJ0001", name: "新PJ", status: "active" },
    });
    expect(result.current.message).toBe("プロジェクトを仮登録し、承認を申請しました(承認待ち)");
  });

  it("承認 ON の変更: 今の内容のまま temporary にロックし、変更後の内容で変更(UPDATE)を申請する", async () => {
    const calls = stubFetch((c) => (c.url.includes("request-status") ? { status: "APPROVED" } : []));
    const { result } = renderHook(() => useProjects({ ...base, isProjectWfEnabled: true, departments }));
    act(() => {
      result.current.setEditingProject({ id: "PJ-1", name: "旧名", memo: null, startDate: null, endDate: null, status: "active" });
    });

    await act(async () => {
      await result.current.handleSubmit({ ...form, id: "PJ-1", name: "新名" });
    });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain("/api/projects/PJ-1");
    expect(put.body).toMatchObject({ name: "旧名", status: "temporary" });
    const request = calls.find((c) => c.url.includes("/api/approvals/request-update"))!;
    expect(request.body).toMatchObject({ requestType: "UPDATE", targetId: "PJ-1", payload: { name: "新名" } });
  });

  it("承認待ち(PENDING)の仮登録は編集できない", async () => {
    const calls = stubFetch((c) => (c.url.includes("request-status") ? { status: "PENDING" } : []));
    const { result } = renderHook(() => useProjects({ ...base, isProjectWfEnabled: true, departments }));
    act(() => {
      result.current.setEditingProject({ id: "PJ-2", name: "申請中", memo: null, startDate: null, endDate: null, status: "temporary" });
    });
    await waitFor(() => expect(result.current.isProjectCurrentlyLocked).toBe(true));

    let ok = true;
    await act(async () => {
      ok = await result.current.handleSubmit({ ...form, id: "PJ-2" });
    });
    expect(ok).toBe(false);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("承認 OFF は今まで通り、そのまま登録する(申請しない)", async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useProjects({ ...base, isProjectWfEnabled: false }));
    await act(async () => {
      await result.current.handleSubmit(form);
    });
    expect(calls.some((c) => c.url.includes("/api/projects/register"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/api/approvals/request-update"))).toBe(false);
    expect(result.current.message).toBe("新しいプロジェクトを登録しました");
  });
});
