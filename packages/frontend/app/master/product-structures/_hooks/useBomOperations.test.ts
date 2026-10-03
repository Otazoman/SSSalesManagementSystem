import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useBomOperations, getPeriodStatus, formatToInputDate } from "./useBomOperations";
import { StructureRecord } from "../_types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function defaultProps() {
  return { canRead: true, canCreate: true, canUpdate: true, canDelete: true };
}

function makeStructure(overrides: Partial<StructureRecord> = {}): StructureRecord {
  return {
    id: "STR-1",
    parentItemId: "ITEM-PARENT",
    parentItemName: "完成品A",
    childItemId: "ITEM-CHILD",
    childItemName: "部品B",
    childItemStatus: "active",
    quantityRequired: 2,
    revision: "1.0",
    validFrom: "2026-01-01",
    validTo: null,
    memo: null,
    childUnitPrice: 100,
    subTotalCost: 200,
    status: "active",
    ...overrides,
  };
}

function mockLookupsAndStructures(
  fetchSpy: ReturnType<typeof vi.fn>,
  opts: { structures?: StructureRecord[] } = {},
) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/products")) return jsonResponse([{ id: "ITEM-PARENT", name: "完成品A", status: "active" }]);
    if (u.includes("/api/item-structures/active-parents"))
      return jsonResponse([{ id: "ITEM-PARENT", name: "完成品A" }]);
    if (u.includes("/api/item-structures")) return jsonResponse(opts.structures ?? []);
    return jsonResponse({});
  });
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPeriodStatus", () => {
  it("開始日が未来の場合はfutureを返す", () => {
    const status = getPeriodStatus("2999-01-01", null);
    expect(status.code).toBe("future");
  });

  it("終了日が過去の場合はexpiredを返す", () => {
    const status = getPeriodStatus("2000-01-01", "2000-02-01");
    expect(status.code).toBe("expired");
  });

  it("開始日が過去かつ終了日未指定/未来の場合はcurrentを返す", () => {
    expect(getPeriodStatus("2000-01-01", null).code).toBe("current");
  });
});

describe("formatToInputDate", () => {
  it("ISO文字列はT区切り前の日付部分を返す", () => {
    expect(formatToInputDate("2026-03-05T00:00:00.000Z")).toBe("2026-03-05");
  });

  it("nullや空文字は空文字を返す", () => {
    expect(formatToInputDate(null)).toBe("");
    expect(formatToInputDate("")).toBe("");
  });

  it("数値(タイムスタンプ)はISO日付へ変換する", () => {
    const ts = new Date("2026-05-01").getTime();
    expect(formatToInputDate(ts)).toBe("2026-05-01");
  });
});

describe("useBomOperations", () => {
  it("初期ロードでallItems/bomParents/structuresを取得する", async () => {
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy, { structures: [makeStructure()] });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useBomOperations(defaultProps()));

    await waitFor(() => expect(result.current.structures).toHaveLength(1));
    expect(result.current.allItems).toEqual([
      { id: "ITEM-PARENT", name: "完成品A", status: "active" },
    ]);
    expect(result.current.bomParents).toEqual([{ id: "ITEM-PARENT", name: "完成品A" }]);
  });

  it("displayedStructuresはfilterStatusでクライアント側フィルタする", async () => {
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy, {
      structures: [
        makeStructure({ id: "STR-1", status: "active" }),
        makeStructure({ id: "STR-2", status: "suspended" }),
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useBomOperations(defaultProps()));
    await waitFor(() => expect(result.current.structures).toHaveLength(2));

    expect(result.current.displayedStructures).toHaveLength(1);
    expect(result.current.displayedStructures[0].id).toBe("STR-1");

    act(() => {
      result.current.setFilterStatus("all");
    });
    expect(result.current.displayedStructures).toHaveLength(2);
  });

  it("displayedStructuresはfilterPeriodでも絞り込む", async () => {
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy, {
      structures: [
        makeStructure({ id: "STR-1", validFrom: "2000-01-01", validTo: "2000-02-01" }), // expired
        makeStructure({ id: "STR-2", validFrom: "2000-01-01", validTo: null }), // current
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useBomOperations(defaultProps()));
    await waitFor(() => expect(result.current.structures).toHaveLength(2));

    act(() => {
      result.current.setFilterStatus("all");
      result.current.setFilterPeriod("expired");
    });
    expect(result.current.displayedStructures.map((s) => s.id)).toEqual(["STR-1"]);
  });

  it("bomTreeは孫部品以下も含めて多階層で展開し、積算原価を計算する", async () => {
    const fetchSpy = vi.fn();
    const structures = [
      makeStructure({
        id: "STR-1",
        parentItemId: "TOP",
        childItemId: "MID",
        revision: "1.0",
        quantityRequired: 2,
        childUnitPrice: 10,
      }),
      makeStructure({
        id: "STR-2",
        parentItemId: "MID",
        childItemId: "LEAF",
        revision: "1.0",
        quantityRequired: 3,
        childUnitPrice: 5,
      }),
    ];
    mockLookupsAndStructures(fetchSpy, { structures });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useBomOperations(defaultProps()));
    await waitFor(() => expect(result.current.structures).toHaveLength(2));

    act(() => {
      result.current.setTreeTargetParentId("TOP");
      result.current.setTreeTargetRevision("1.0");
    });

    expect(result.current.bomTree).toHaveLength(1);
    const midNode = result.current.bomTree[0];
    expect(midNode.childItemId).toBe("MID");
    expect(midNode.effectiveQuantity).toBe(2);
    expect(midNode.children).toHaveLength(1);
    const leafNode = midNode.children[0];
    expect(leafNode.childItemId).toBe("LEAF");
    expect(leafNode.effectiveQuantity).toBe(6); // 2 * 3
    expect(leafNode.effectiveSubTotal).toBe(30); // 6 * 5
    expect(result.current.totalTreeBomCost).toBe(20 + 30); // MID:2*10 + LEAF:30
  });

  it("承認ワークフロー無効の新規登録: /api/item-structures/registerへPOSTする", async () => {
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useBomOperations(defaultProps()));
    await waitFor(() => expect(result.current.allItems.length).toBe(1));

    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/item-structures/register")) {
        const body = JSON.parse(init?.body as string);
        expect(body.parentItemId).toBe("TOP");
        return jsonResponse({ id: "STR-NEW" });
      }
      return jsonResponse([]);
    });

    act(() => {
      result.current.setParentItemId("TOP");
      result.current.setChildItemId("CHILD");
      result.current.setValidFrom("2026-01-01");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(result.current.message).toBe("リビジョン [1.0] の品目構成(BOM)を保存しました");
  });

  it("親品番と子部品が同一の場合はエラーにしてfetchしない", async () => {
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useBomOperations(defaultProps()));
    await waitFor(() => expect(result.current.allItems.length).toBe(1));

    fetchSpy.mockClear();
    act(() => {
      result.current.setParentItemId("SAME");
      result.current.setChildItemId("SAME");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(result.current.error).toBe(
      "エラー: 親品番と子部品に同一の品目は指定できません",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("承認ワークフロー有効の新規登録: 仮登録後にapprovals/request-updateを申請する", async () => {
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() =>
      useBomOperations({ ...defaultProps(), isItemStructureWfEnabled: true }),
    );
    await waitFor(() => expect(result.current.allItems.length).toBe(1));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrls.push(url.toString());
      if (url.toString().includes("/api/item-structures/register")) {
        const body = JSON.parse(init?.body as string);
        expect(body.status).toBe("temporary");
        return jsonResponse({ id: "STR-NEW" });
      }
      if (url.toString().includes("/api/approvals/request-update")) {
        const body = JSON.parse(init?.body as string);
        expect(body.targetType).toBe("master_structures");
        expect(body.targetId).toBe("STR-NEW");
        return jsonResponse({});
      }
      if (url.toString().includes("/api/item-structures?")) return jsonResponse([]);
      if (url.toString().includes("/api/item-structures/active-parents")) return jsonResponse([]);
      if (url.toString().includes("/api/products")) return jsonResponse([]);
      return jsonResponse({});
    });

    act(() => {
      result.current.setParentItemId("TOP");
      result.current.setChildItemId("CHILD");
      result.current.setValidFrom("2026-01-01");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    expect(calledUrls.some((u) => u.includes("/api/item-structures/register"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/approvals/request-update"))).toBe(true);
    expect(result.current.message).toBe(
      "品目構成を仮登録し、承認を申請しました(承認待ち)",
    );
  });

  it("追加要望F: 複数部署所属時、選択中の申請部署をrequest-updateのペイロードに含める", async () => {
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const departments = [
      { surrogateId: "dept-a", id: "D001", name: "営業統括部" },
      { surrogateId: "dept-b", id: "D002", name: "人事総務部" },
    ];
    const { result } = renderHook(() =>
      useBomOperations({ ...defaultProps(), isItemStructureWfEnabled: true, departments }),
    );
    await waitFor(() => expect(result.current.allItems.length).toBe(1));
    expect(result.current.applicantDepartmentSurrogateId).toBe("dept-a");
    act(() => result.current.setApplicantDepartmentSurrogateId("dept-b"));

    const calledUrls: { url: string; body: any }[] = [];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calledUrls.push({ url: url.toString(), body });
      if (url.toString().includes("/api/item-structures/register")) {
        return jsonResponse({ id: "STR-NEW" });
      }
      if (url.toString().includes("/api/item-structures?")) return jsonResponse([]);
      if (url.toString().includes("/api/item-structures/active-parents")) return jsonResponse([]);
      if (url.toString().includes("/api/products")) return jsonResponse([]);
      return jsonResponse({});
    });

    act(() => {
      result.current.setParentItemId("TOP");
      result.current.setChildItemId("CHILD");
      result.current.setValidFrom("2026-01-01");
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: () => {} } as React.SyntheticEvent);
    });

    const request = calledUrls.find((c) => c.url.includes("/api/approvals/request-update"));
    expect(request!.body.applicantDepartmentSurrogateId).toBe("dept-b");
  });

  it("handleDeleteLinkは確認キャンセル時はDELETEを呼ばない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy, { structures: [makeStructure()] });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useBomOperations(defaultProps()));
    await waitFor(() => expect(result.current.structures).toHaveLength(1));

    await act(async () => {
      await result.current.handleDeleteLink("STR-1");
    });

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/item-structures/STR-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("handleSuspend(承認無効)は/suspendエンドポイントを呼ぶ", async () => {
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy, { structures: [makeStructure()] });
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useBomOperations(defaultProps()));
    await waitFor(() => expect(result.current.structures).toHaveLength(1));

    const calledUrls: string[] = [];
    fetchSpy.mockImplementation(async (url: string) => {
      calledUrls.push(url.toString());
      if (url.toString().includes("/api/item-structures?")) return jsonResponse([]);
      if (url.toString().includes("/api/item-structures/active-parents")) return jsonResponse([]);
      if (url.toString().includes("/api/products")) return jsonResponse([]);
      return jsonResponse({});
    });

    await act(async () => {
      await result.current.handleSuspend(result.current.structures[0]);
    });

    expect(calledUrls.some((u) => u.includes("/api/item-structures/STR-1/suspend"))).toBe(true);
    expect(result.current.message).toBe("品目構成を無効化しました");
  });

  it("handleClearSearch/handleClearFormは検索条件・フォーム状態をリセットする", async () => {
    const fetchSpy = vi.fn();
    mockLookupsAndStructures(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useBomOperations(defaultProps()));
    await waitFor(() => expect(result.current.allItems.length).toBe(1));

    act(() => {
      result.current.setSearchParentId("X");
      result.current.setSearchChildId("Y");
      result.current.setParentItemId("A");
      result.current.setChildItemId("B");
    });

    act(() => {
      result.current.handleClearSearch();
      result.current.handleClearForm();
    });

    expect(result.current.searchParentId).toBe("");
    expect(result.current.searchChildId).toBe("");
    expect(result.current.parentItemId).toBe("");
    expect(result.current.childItemId).toBe("");
  });
});
