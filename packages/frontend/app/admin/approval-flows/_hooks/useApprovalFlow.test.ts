import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useApprovalFlow } from "./useApprovalFlow";
import { ApprovalFlowRecord } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const activeFlow: ApprovalFlowRecord = {
  id: "f1",
  name: "購買申請_通常",
  requestType: "master_units",
  minAmount: 0,
  maxAmount: 100000,
  isActive: true,
  matchField: null,
  matchValue: null,
  steps: [
    {
      id: "s1",
      stepOrder: 1,
      approverRoleId: "general_user",
      roleName: "一般ユーザー",
      targetDepartmentSurrogateId: null,
      stepName: "承認",
      memo: null,
    },
  ],
};

const inactiveFlow: ApprovalFlowRecord = { ...activeFlow, id: "f2", isActive: false, name: "廃止フロー" };

function mockBaseFetches(fetchSpy: ReturnType<typeof vi.fn>, flows: unknown[] = []) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/approval-flows")) return jsonResponse(flows);
    if (u.includes("/api/roles")) return jsonResponse([{ id: "general_user", name: "一般ユーザー" }]);
    if (u.includes("/api/permissions/screens")) {
      return jsonResponse([
        { resource: "master_units", name: "単位マスタ", category: "business_master" },
        { resource: "workflow_tasks", name: "ワークフロー", category: "daily_work" },
        { resource: "admin_users", name: "管理", category: "admin" },
      ]);
    }
    if (u.includes("/api/departments")) return jsonResponse([]);
    return jsonResponse({});
  });
}

function baseArgs(overrides: Partial<Parameters<typeof useApprovalFlow>[0]> = {}) {
  return { canRead: true, canCreate: true, canUpdate: true, loadingPermissions: false, ...overrides };
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useApprovalFlow", () => {
  it("初期化: フロー一覧・ロール・画面選択肢(business_master/daily_workのみ)を取得する", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy, [activeFlow]);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useApprovalFlow(baseArgs()));

    await waitFor(() => expect(result.current.flows.length).toBe(1));
    expect(result.current.screens.map((s) => s.resource)).toEqual([
      "master_units",
      "workflow_tasks",
    ]);
    expect(result.current.selectedRoleId).toBe("general_user");
  });

  it("filteredFlows: filterStatus=activeの間はisActive:trueのみ返す(デフォルト)", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy, [activeFlow, inactiveFlow]);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useApprovalFlow(baseArgs()));

    await waitFor(() => expect(result.current.flows.length).toBe(2));
    expect(result.current.filteredFlows).toEqual([activeFlow]);
  });

  it("filterStatusをinactiveへ切り替えると無効フローのみ返す", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy, [activeFlow, inactiveFlow]);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useApprovalFlow(baseArgs()));
    await waitFor(() => expect(result.current.flows.length).toBe(2));

    act(() => result.current.setFilterStatus("inactive"));
    expect(result.current.filteredFlows).toEqual([inactiveFlow]);
  });

  it("addStepToBuilder/removeStepFromBuilder: ステップの追加・削除ができる", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useApprovalFlow(baseArgs()));
    await waitFor(() => expect(result.current.selectedRoleId).toBe("general_user"));

    act(() => result.current.addStepToBuilder());
    expect(result.current.builderSteps.length).toBe(1);
    expect(result.current.builderSteps[0].approverRoleId).toBe("general_user");

    act(() => result.current.removeStepFromBuilder(0));
    expect(result.current.builderSteps.length).toBe(0);
  });

  it("handleEditClick: canUpdate:falseの場合はerrorを設定し編集状態にしない", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy, [activeFlow]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useApprovalFlow(baseArgs({ canUpdate: false })));
    await waitFor(() => expect(result.current.flows.length).toBe(1));

    act(() => result.current.handleEditClick(activeFlow));

    expect(result.current.error).toBe(
      "⚠️ あなたのロールには、このマスタを変更する権限がありません",
    );
    expect(result.current.editingFlowId).toBeNull();
  });

  it("handleEditClick: canUpdate:trueの場合はフォーム状態へ値を反映する", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy, [activeFlow]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useApprovalFlow(baseArgs()));
    await waitFor(() => expect(result.current.flows.length).toBe(1));

    act(() => result.current.handleEditClick(activeFlow));

    expect(result.current.editingFlowId).toBe("f1");
    expect(result.current.flowName).toBe("購買申請_通常");
    expect(result.current.builderSteps).toEqual([
      { approverRoleId: "general_user", targetDepartmentSurrogateId: null, stepName: "承認", memo: "" },
    ]);
  });

  it("handleSubmitFlow: builderStepsが空の場合は送信をブロックする", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useApprovalFlow(baseArgs()));
    await waitFor(() => expect(result.current.selectedRoleId).toBe("general_user"));
    fetchSpy.mockClear();

    await act(async () => {
      await result.current.handleSubmitFlow({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(result.current.error).toBe(
      "少なくとも1段階以上の承認ステップを組み立ててください",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handleSubmitFlow: 新規登録はPOSTし、成功メッセージを設定してフォームをリセットする", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useApprovalFlow(baseArgs()));
    await waitFor(() => expect(result.current.selectedRoleId).toBe("general_user"));

    act(() => result.current.setFlowName("新規フロー"));
    act(() => result.current.setRequestType("master_units"));
    act(() => result.current.addStepToBuilder());

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString() === "/api/approval-flows" && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        expect(body.name).toBe("新規フロー");
        expect(body.steps.length).toBe(1);
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleSubmitFlow({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(result.current.message).toBe("動的承認ルート定義をマスタへ反映しました");
    expect(result.current.editingFlowId).toBeNull();
  });

  it("handleSubmitFlow: matchField/matchValueの片方だけ入力した場合は送信をブロックする", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useApprovalFlow(baseArgs()));
    await waitFor(() => expect(result.current.selectedRoleId).toBe("general_user"));

    act(() => result.current.addStepToBuilder());
    act(() => result.current.setMatchField("requestType"));
    fetchSpy.mockClear();

    await act(async () => {
      await result.current.handleSubmitFlow({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(result.current.error).toBe(
      "詳細マッチ条件は「対象フィールド」「期待値」の両方を入力するか、両方とも空欄にしてください",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handleSubmitFlow: matchField/matchValueを両方入力した場合は送信bodyに含める", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useApprovalFlow(baseArgs()));
    await waitFor(() => expect(result.current.selectedRoleId).toBe("general_user"));

    act(() => result.current.setFlowName("条件付きフロー"));
    act(() => result.current.setRequestType("master_units"));
    act(() => result.current.addStepToBuilder());
    act(() => result.current.setMatchField("requestType"));
    act(() => result.current.setMatchValue("CONSUMABLE"));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString() === "/api/approval-flows" && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        expect(body.matchField).toBe("requestType");
        expect(body.matchValue).toBe("CONSUMABLE");
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleSubmitFlow({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(result.current.message).toBe("動的承認ルート定義をマスタへ反映しました");
  });

  it("handleDisableFlow: 確認後POSTしメッセージを設定する", async () => {
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy, [activeFlow]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useApprovalFlow(baseArgs()));
    await waitFor(() => expect(result.current.flows.length).toBe(1));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/approval-flows/f1/suspend") && init?.method === "POST") {
        return jsonResponse({});
      }
      return jsonResponse([]);
    });

    await act(async () => {
      await result.current.handleDisableFlow("f1", "購買申請_通常");
    });

    expect(result.current.message).toBe("承認フロー設定を無効化しました");
  });

  it("handlePurgeFlow: 確認をキャンセルした場合はAPIを叩かない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchSpy = vi.fn();
    mockBaseFetches(fetchSpy, [inactiveFlow]);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useApprovalFlow(baseArgs()));
    await waitFor(() => expect(result.current.flows.length).toBe(1));
    fetchSpy.mockClear();

    await act(async () => {
      await result.current.handlePurgeFlow("f2", "廃止フロー");
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
