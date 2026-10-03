import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

async function importPage() {
  const mod = await import("./page");
  return mod.default;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function basePermissions() {
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    loading: false,
    isPurchaseRequisitionWfEnabled: false,
    departments: [],
  };
}

function mockAllFetches(
  fetchSpy: ReturnType<typeof vi.fn>,
  opts: { requisitions?: unknown[]; suppliers?: unknown[] } = {},
) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/products")) return jsonResponse([]);
    if (u.includes("/api/projects")) return jsonResponse([]);
    if (u.includes("/api/partners")) return jsonResponse(opts.suppliers ?? []);
    if (u.includes("/api/departments")) return jsonResponse([]);
    if (u.includes("/api/users")) return jsonResponse([]);
    if (u.includes("/api/units")) return jsonResponse([]);
    if (u.includes("/api/tax-categories")) return jsonResponse([]);
    if (u.includes("/api/accounts")) return jsonResponse([]);
    if (u.includes("/api/purchase-requisitions")) return jsonResponse(opts.requisitions ?? []);
    return jsonResponse({});
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PurchaseRequisitionsPage", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), loading: true });
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({ ...basePermissions(), canRead: false });
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });

  it("canRead:trueの場合は一覧取得後にタイトルと購買申請データを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy, {
      requisitions: [
        {
          id: "PR-1",
          title: "事務用品購入",
          status: "DRAFT",
          requestType: "ONE_TIME",
          totalAmount: 1000,
          departmentSurrogateId: "dept-a",
          applicantId: "applicant-1",
          memo: null,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("事務用品購入")).toBeInTheDocument());
    expect(screen.getByText("📝 購買申請")).toBeInTheDocument();
  });

  it("「購買申請を新規登録・申請する」クリックで一覧⇔フォームを見積画面と同じ全画面切替で表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    // LIST表示時は一覧のツールバー(状態タブ・CSVインポート/エクスポート)が見える
    expect(screen.getByRole("button", { name: "📤 CSVインポート" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "➕ 購買申請を新規登録・申請する" }));
    expect(screen.getByText("➕ 新規購買申請の起票")).toBeInTheDocument();
    // FORM表示中は一覧のツールバーが消え、「一覧画面へ戻る」が現れる
    expect(screen.queryByRole("button", { name: "📤 CSVインポート" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "↩ 一覧画面へ戻る" }).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole("button", { name: "↩ 一覧画面へ戻る" })[0]);
    expect(screen.queryByText("➕ 新規購買申請の起票")).not.toBeInTheDocument();
  });

  it("承認機能ON時はCSVインポートボタンが無効化される(緊急-2と同種の承認バイパス対策)", async () => {
    mockUsePagePermissions.mockReturnValue({
      ...basePermissions(),
      isPurchaseRequisitionWfEnabled: true,
    });
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    expect(screen.getByRole("button", { name: "📤 CSVインポート" })).toBeDisabled();
  });

  it("Phase3フォローアップ: フォームに仕入先選択(マスタ/手入力)と添付ファイル(共有リンク)欄が表示される", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy, { suppliers: [{ id: "PARTNER-1", name: "仕入先A" }] });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "➕ 購買申請を新規登録・申請する" }));

    expect(screen.getByText(/^仕入先/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "[PARTNER-1] 仕入先A" })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: "🔗 共有リンク貼付" }));
    expect(screen.getByPlaceholderText("https://...")).toBeInTheDocument();
  });

  it("Phase6起票トリガー①: 「受注を指定せず、欠品明細をすべてまとめて表示」から複数受注にまたがる欠品を選択し購買申請フォームへプレフィルする", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    fetchSpy.mockImplementation(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/sales-orders/backordered-items")) {
        return jsonResponse([
          {
            salesOrderId: "SO-1",
            salesOrderTitle: "受注1",
            id: "SOI-1",
            itemId: "ITEM-1",
            itemName: "品目A",
            inputType: "MASTER",
            quantity: 10,
            backorderedQuantity: 4,
            unitPrice: 500,
            unitCode: "PCS",
            taxCategoryCode: "TAX_10",
          },
          {
            salesOrderId: "SO-2",
            salesOrderTitle: "受注2",
            id: "SOI-2",
            itemId: "ITEM-2",
            itemName: "品目B",
            inputType: "MASTER",
            quantity: 5,
            backorderedQuantity: 2,
            unitPrice: 300,
            unitCode: "PCS",
            taxCategoryCode: "TAX_10",
          },
        ]);
      }
      if (u.includes("/api/sales-orders")) return jsonResponse([]);
      if (u.includes("/api/products")) return jsonResponse([]);
      if (u.includes("/api/projects")) return jsonResponse([]);
      if (u.includes("/api/partners")) return jsonResponse([]);
      if (u.includes("/api/departments")) return jsonResponse([]);
      if (u.includes("/api/users")) return jsonResponse([]);
      if (u.includes("/api/units")) return jsonResponse([]);
      if (u.includes("/api/tax-categories")) return jsonResponse([]);
      if (u.includes("/api/accounts")) return jsonResponse([]);
      if (u.includes("/api/purchase-requisitions")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "🔗 受注の欠品から購買申請を作成" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /受注を指定せず、欠品明細をすべてまとめて表示/ }),
      ).toBeInTheDocument(),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /受注を指定せず、欠品明細をすべてまとめて表示/ }),
    );

    await waitFor(() => expect(screen.getByText("品目A")).toBeInTheDocument());
    expect(screen.getByText("品目B")).toBeInTheDocument();
    expect(screen.getByText("受注1")).toBeInTheDocument();
    expect(screen.getByText("受注2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "購買申請フォームへ内容をコピー" }));

    expect(screen.getByDisplayValue("欠品調達(受注2件)")).toBeInTheDocument();
  });

  it("Phase7起票トリガー①(発注点/安全在庫方式): 「発注点/安全在庫を下回った品目から購買申請を作成」から候補を選択し購買申請フォームへプレフィルする", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    fetchSpy.mockImplementation(async (url: string) => {
      const u = url.toString();
      if (u.includes("/api/item-reorder-settings/low-stock-candidates")) {
        return jsonResponse([
          {
            id: "SET-1",
            itemId: "ITEM-1",
            itemName: "品目A",
            baseUnitCode: "PCS",
            taxCategoryCode: "TAX_10",
            warehouseId: "WH-1",
            warehouseName: "本社倉庫",
            reorderPoint: 10,
            safetyStock: 20,
            currentStock: 3,
            suggestedQuantity: 17,
          },
        ]);
      }
      if (u.includes("/api/products")) return jsonResponse([]);
      if (u.includes("/api/projects")) return jsonResponse([]);
      if (u.includes("/api/partners")) return jsonResponse([]);
      if (u.includes("/api/departments")) return jsonResponse([]);
      if (u.includes("/api/users")) return jsonResponse([]);
      if (u.includes("/api/units")) return jsonResponse([]);
      if (u.includes("/api/tax-categories")) return jsonResponse([]);
      if (u.includes("/api/accounts")) return jsonResponse([]);
      if (u.includes("/api/purchase-requisitions")) return jsonResponse([]);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(
      screen.getByRole("button", { name: "📉 発注点/安全在庫を下回った品目から購買申請を作成" }),
    );

    await waitFor(() => expect(screen.getByText("品目A")).toBeInTheDocument());
    expect(screen.getByText("本社倉庫")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "購買申請フォームへ内容をコピー" }));

    expect(screen.getByDisplayValue("発注点補充(品目1件)")).toBeInTheDocument();
  });
});

describe("PurchaseRequisitionsPage(編集キャンセル時の確認)", () => {
  it("フォームを編集後、ヘッダーの「一覧画面へ戻る」を押すと確認し、続けるを選ぶと閉じない", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "➕ 購買申請を新規登録・申請する" }));
    expect(screen.getByText("➕ 新規購買申請の起票")).toBeInTheDocument();

    await userEvent.type(screen.getAllByRole("textbox")[0], "テスト用の件名");
    await userEvent.click(screen.getAllByRole("button", { name: "↩ 一覧画面へ戻る" })[0]);

    expect(confirmSpy).toHaveBeenCalledWith("保存していない編集を破棄しますか？");
    expect(screen.getByText("➕ 新規購買申請の起票")).toBeInTheDocument();
  });

  it("フォームを編集後、ヘッダーの「一覧画面へ戻る」を押して破棄を選ぶと一覧に戻る", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "➕ 購買申請を新規登録・申請する" }));
    await userEvent.type(screen.getAllByRole("textbox")[0], "テスト用の件名");
    await userEvent.click(screen.getAllByRole("button", { name: "↩ 一覧画面へ戻る" })[0]);

    expect(screen.queryByText("➕ 新規購買申請の起票")).not.toBeInTheDocument();
  });

  it("フォーム内の「一覧画面へ戻る」(キャンセル)を押しても、編集していれば同じ確認が出る", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "➕ 購買申請を新規登録・申請する" }));
    await userEvent.type(screen.getAllByRole("textbox")[0], "テスト用の件名");

    const backButtons = screen.getAllByRole("button", { name: "↩ 一覧画面へ戻る" });
    await userEvent.click(backButtons[backButtons.length - 1]);

    expect(confirmSpy).toHaveBeenCalledWith("保存していない編集を破棄しますか？");
    expect(screen.getByText("➕ 新規購買申請の起票")).toBeInTheDocument();
  });

  it("何も編集していなければ、「一覧画面へ戻る」で確認せずに一覧に戻る(既存動作を維持)", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockAllFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const confirmSpy = vi.spyOn(window, "confirm");
    const Page = await importPage();

    render(<Page />);
    await waitFor(() => expect(screen.queryByText("権限を確認中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "➕ 購買申請を新規登録・申請する" }));
    await userEvent.click(screen.getAllByRole("button", { name: "↩ 一覧画面へ戻る" })[0]);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("➕ 新規購買申請の起票")).not.toBeInTheDocument();
  });
});
