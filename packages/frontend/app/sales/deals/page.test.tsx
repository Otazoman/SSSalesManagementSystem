import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

function importPage() {
  return import("./page").then((mod) => mod.default);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const deal = {
  id: "DL0001",
  partnerId: "PR-1",
  partnerName: "見込み商事",
  title: "初回ヒアリング",
  dealDate: "2026-09-10",
  startTime: "10:00",
  endTime: "11:30",
  location: null,
  status: "OPEN",
  ownerEmployeeNumber: "EMP001",
  ownerName: "営業太郎",
  attendeeNames: ["見込客の佐藤", "未登録の田中"],
  taskCount: 2,
  openTaskCount: 1,
  attachmentCount: 1,
  quoteIds: ["Q-1"],
};

const openTask = {
  id: "T-1",
  dealId: "DL0001",
  dealTitle: "初回ヒアリング",
  partnerId: "PR-1",
  partnerName: "見込み商事",
  title: "見積提出",
  dueDate: "2026-09-17",
  assigneeEmployeeNumber: "EMP001",
  assigneeName: "営業太郎",
  isDone: false,
};

const detail = {
  ...deal,
  memo: "予算感は500万円",
  attendees: [
    {
      id: "A-1",
      kind: "PROSPECT_CONTACT",
      refId: "PC-1",
      name: "見込客の佐藤",
      note: "情報システム部",
    },
    { id: "A-2", kind: "FREE", refId: null, name: "未登録の田中", note: null },
  ],
  tasks: [{ ...openTask }],
  attachments: [
    {
      id: "F-1",
      fileName: "議事録.pdf",
      fileType: "PDF",
      uploadedAt: "2026-09-10T01:00:00.000Z",
    },
  ],
  quotes: [
    {
      id: "Q-1",
      title: "見積",
      status: "APPROVED",
      quoteDate: "2026-09-09",
      totalAmount: 1000,
    },
  ],
};

function mockFetch(deals: unknown[] = [deal], tasks: unknown[] = [openTask]) {
  const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    const u = url.toString();
    if (u.includes("/api/sales-deals/tasks")) {
      // 取引先の指定があれば、その取引先のタスクのみ返す(サーバーの絞り込みを模擬)
      const partnerId = new URL(u, "http://localhost").searchParams.get("partnerId");
      return jsonResponse(
        partnerId ? tasks.filter((t) => (t as { partnerId?: string }).partnerId === partnerId) : tasks,
      );
    }
    if (u.includes("/api/sales-deals/DL0001/tasks/T-1/done"))
      return jsonResponse({ success: true });
    if (u.includes("/api/sales-deals/attendee-candidates")) {
      return jsonResponse({
        partnerContacts: [],
        prospectContacts: [
          {
            id: "PC-1",
            partnerId: "PR-1",
            name: "見込客の佐藤",
            departmentName: "情報システム部",
            position: null,
            email: null,
            phone: null,
            memo: null,
          },
        ],
      });
    }
    if (u.includes("/api/sales-deals/quote-candidates"))
      return jsonResponse([
        {
          id: "Q-1",
          title: "見積",
          status: "APPROVED",
          quoteDate: "2026-09-09",
          totalAmount: 1000,
        },
      ]);
    if (
      u.includes("/api/sales-deals/DL0001") &&
      (!init?.method || init.method === "GET")
    )
      return jsonResponse(detail);
    if (u.includes("/api/sales-deals")) return jsonResponse(deals);
    if (u.includes("/api/partners"))
      return jsonResponse([
        { id: "PR-1", name: "見込み商事", type: "PROSPECT" },
        { id: "SUP-1", name: "仕入先", type: "SUPPLIER" },
      ]);
    if (u.includes("/api/users"))
      return jsonResponse([
        { employeeNumber: "EMP001", name: "営業太郎", isActive: true },
      ]);
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  mockUsePagePermissions.mockReturnValue({
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    loading: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DealsPage(商談管理)", () => {
  it("権限確認中はLoadingGate、閲覧権限がなければAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue({
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
      loading: true,
    });
    mockFetch();
    const Page = await importPage();
    const { rerender } = render(<Page />);
    expect(screen.getByText("権限を確認中...")).toBeInTheDocument();

    mockUsePagePermissions.mockReturnValue({
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
      loading: false,
    });
    rerender(<Page />);
    expect(
      screen.getByText("🔒 この画面を閲覧する権限がありません"),
    ).toBeInTheDocument();
  });

  it("商談一覧に面談者・未完了タスク・見積を表示し、未完了タスク一覧も表示する", async () => {
    mockFetch();
    const Page = await importPage();
    render(<Page />);

    await waitFor(() =>
      expect(screen.getAllByText("初回ヒアリング").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("DL0001", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("見込客の佐藤、未登録の田中")).toBeInTheDocument();
    expect(screen.getByText("1件", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Q-1")).toBeInTheDocument();
    // 未完了タスク一覧
    expect(screen.getByText("見積提出")).toBeInTheDocument();
    expect(screen.getByText("2026-09-17")).toBeInTheDocument();
  });

  it("取引先の選択肢は見込み客・顧客のみ(仕入先は含まない)", async () => {
    mockFetch();
    const Page = await importPage();
    render(<Page />);
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "[PR-1] 見込み商事" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("option", { name: /仕入先/ })).toBeNull();
  });

  it("取引先を選ぶと(検索ボタン無しで)、次回までのタスクもその取引先のタスクのみに絞り込み、条件をクリアで全件に戻す", async () => {
    const fetchSpy = mockFetch(
      [deal],
      [
        openTask,
        {
          ...openTask,
          id: "T-2",
          dealId: "DL0002",
          dealTitle: "別の商談",
          partnerId: "PR-2",
          partnerName: "別の見込み客",
          title: "資料送付",
        },
      ],
    );
    const Page = await importPage();
    render(<Page />);
    await waitFor(() => expect(screen.getByText("資料送付")).toBeInTheDocument());
    expect(screen.getByText("見積提出")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "[PR-1] 見込み商事" })).toBeInTheDocument(),
    );

    // BUG-031: 「検索」ボタンは無く、条件を変えると少し待ってから検索する
    expect(screen.queryByRole("button", { name: "検索" })).toBeNull();
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "PR-1" } });
    await waitFor(() => expect(screen.queryByText("資料送付")).toBeNull());
    expect(fetchSpy).toHaveBeenCalledWith("/api/sales-deals/tasks?partnerId=PR-1", expect.anything());
    expect(screen.getByText("見積提出")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    await waitFor(() => expect(screen.getByText("資料送付")).toBeInTheDocument());
  });

  it("タスクを「完了にする」と完了APIを呼ぶ(更新権限がある場合のみ表示)", async () => {
    const fetchSpy = mockFetch();
    const Page = await importPage();
    const { unmount } = render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("見積提出")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("完了にする"));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/sales-deals/DL0001/tasks/T-1/done",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ isDone: true }),
        }),
      ),
    );
    unmount();

    mockUsePagePermissions.mockReturnValue({
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      loading: false,
    });
    mockFetch();
    const Page2 = await importPage();
    render(<Page2 />);
    await waitFor(() =>
      expect(screen.getByText("見積提出")).toBeInTheDocument(),
    );
    expect(screen.queryByText("完了にする")).toBeNull();
  });

  it("商談を開くと面談者・タスク・添付・紐づけ見積を表示し、新規登録では添付は登録後と案内する", async () => {
    mockFetch();
    const Page = await importPage();
    render(<Page />);
    await waitFor(() => expect(screen.getByText("編集")).toBeInTheDocument());

    fireEvent.click(screen.getByText("編集"));
    await waitFor(() =>
      expect(screen.getByText("🤝 商談 DL0001")).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("予算感は500万円")).toBeInTheDocument();
    expect(screen.getByText("議事録.pdf")).toBeInTheDocument();
    // 面談者(見込客担当者・その他の未登録の相手)
    expect(screen.getByText("情報システム部")).toBeInTheDocument();
    expect(
      screen.getByText("未登録の田中", { selector: "span.font-semibold" }),
    ).toBeInTheDocument();

    // 編集できる場合の下部ボタンは「キャンセル」(参照のみの場合は「閉じる」)
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() =>
      expect(screen.queryByText("🤝 商談 DL0001")).toBeNull(),
    );
    fireEvent.click(screen.getByText("➕ 商談を登録"));
    await waitFor(() =>
      expect(screen.getByText("🤝 商談を登録")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("商談を登録すると、添付ファイルを追加できます"),
    ).toBeInTheDocument();
  });

  it("作成権限がなければ「商談を登録」ボタンを表示しない", async () => {
    mockUsePagePermissions.mockReturnValue({
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      loading: false,
    });
    mockFetch();
    const Page = await importPage();
    render(<Page />);
    await waitFor(() => expect(screen.getByText("詳細")).toBeInTheDocument());
    expect(screen.queryByText("➕ 商談を登録")).toBeNull();
    expect(screen.queryByText("削除")).toBeNull();
  });
});

describe("DealsPage: CSVインポート", () => {
  function mockImportFetch(importResponse: { body: unknown; status?: number }) {
    const base = mockFetch();
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/sales-deals/bulk-register")) {
        return jsonResponse(importResponse.body, importResponse.status ?? 200);
      }
      return base(url, init);
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  function chooseFile(container: HTMLElement, content = "groupKey\n") {
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File([content], "deals.csv", { type: "text/csv" })],
      },
    });
  }

  it("登録・更新の両権限がある場合のみ、CSVインポートとテンプレートのボタンを表示する", async () => {
    mockFetch();
    const Page = await importPage();
    const { unmount } = render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("CSVインポート")).toBeInTheDocument(),
    );
    expect(screen.getByText("インポート用テンプレート")).toBeInTheDocument();
    unmount();

    mockUsePagePermissions.mockReturnValue({
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      loading: false,
    });
    mockFetch();
    const Page2 = await importPage();
    render(<Page2 />);
    await waitFor(() =>
      expect(screen.getByText("➕ 商談を登録")).toBeInTheDocument(),
    );
    expect(screen.queryByText("CSVインポート")).toBeNull();
    expect(screen.queryByText("インポート用テンプレート")).toBeNull();
  });

  it("CSVを選ぶとbulk-registerへPOST(file)し、成功メッセージを表示して一覧を再取得する", async () => {
    const spy = mockImportFetch({
      body: {
        success: true,
        created: 2,
        updated: 1,
        message: "商談3件を取り込みました(新規2件・更新1件)",
      },
    });
    const Page = await importPage();
    const { container } = render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("CSVインポート")).toBeInTheDocument(),
    );
    const listCallsBefore = spy.mock.calls.filter(
      ([u]) => String(u) === "/api/sales-deals",
    ).length;

    chooseFile(container);

    await waitFor(() =>
      expect(
        screen.getByText("商談3件を取り込みました(新規2件・更新1件)"),
      ).toBeInTheDocument(),
    );
    const importCall = spy.mock.calls.find(([u]) =>
      String(u).includes("/bulk-register"),
    )!;
    expect(importCall[1]).toMatchObject({ method: "POST" });
    expect((importCall[1]!.body as FormData).get("file")).toBeInstanceOf(File);
    const listCallsAfter = spy.mock.calls.filter(
      ([u]) => String(u) === "/api/sales-deals",
    ).length;
    expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
  });

  it("不正な行がある場合は複数行のエラーを表示し、閉じることができる", async () => {
    mockImportFetch({
      status: 400,
      body: {
        success: false,
        message:
          "CSVに不正な行があります(2件)\n2行目: titleは必須です\n3行目: dealDateは必須です",
      },
    });
    const Page = await importPage();
    const { container } = render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("CSVインポート")).toBeInTheDocument(),
    );

    chooseFile(container);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("2行目: titleは必須です");
    expect(alert).toHaveTextContent("3行目: dealDateは必須です");

    fireEvent.click(screen.getByText("閉じる"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("DealsPage: CSVダウンロード", () => {
  function mockExportFetch(headers: Record<string, string>) {
    const base = mockFetch();
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/sales-deals/csv-download")) {
        return new Response("groupKey\n", { status: 200, headers });
      }
      return base(url, init);
    });
    vi.stubGlobal("fetch", spy);
    // jsdomにはobject URLが無いため、ダウンロードのクリックだけ差し替える
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:test"),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    return spy;
  }

  it("取込の上限内に収まらず一部のみ出力した場合は、件数つきの警告を表示する", async () => {
    mockExportFetch({
      "X-Deals-Export-Total": "80",
      "X-Deals-Export-Included": "35",
    });
    const Page = await importPage();
    render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("CSVダウンロード")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("CSVダウンロード"));

    await waitFor(() =>
      expect(
        screen.getByText(
          /80件のうち、CSVインポートで1回に取り込める範囲の先頭35件のみ出力しました/,
        ),
      ).toBeInTheDocument(),
    );
  });

  it("全件を出力できた場合は警告を表示しない", async () => {
    const spy = mockExportFetch({
      "X-Deals-Export-Total": "3",
      "X-Deals-Export-Included": "3",
    });
    const Page = await importPage();
    render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("CSVダウンロード")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("CSVダウンロード"));

    await waitFor(() =>
      expect(
        spy.mock.calls.some(([u]) => String(u).includes("/csv-download")),
      ).toBe(true),
    );
    expect(screen.queryByText(/のみ出力しました/)).toBeNull();
  });
});

describe("DealsPage: 行の選択と右側プレビュー(見積と同じ操作)", () => {
  it("「プレビュー」を押すと、面談者・タスク・見積・添付を読み取り専用で右側パネルに表示し、閉じられる", async () => {
    mockFetch();
    const Page = await importPage();
    render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("プレビュー")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("プレビュー"));

    const panel = await screen.findByRole("dialog", { name: "商談プレビュー" });
    expect(panel).toHaveTextContent("商談プレビュー内容の最終確認");
    expect(panel).toHaveTextContent("予算感は500万円");
    expect(panel).toHaveTextContent("見込客の佐藤");
    expect(panel).toHaveTextContent("見込客担当者");
    expect(panel).toHaveTextContent("見積提出");
    expect(panel).toHaveTextContent("Q-1");
    expect(panel).toHaveTextContent("議事録.pdf");
    // 編集フォーム(モーダル)は開かない
    expect(screen.queryByText("🤝 商談 DL0001")).toBeNull();

    fireEvent.click(screen.getByLabelText("プレビューを閉じる"));
    expect(screen.queryByRole("dialog", { name: "商談プレビュー" })).toBeNull();
  });

  it("行をクリックすると詳細(編集権限があれば編集)フォームを開く。操作ボタンのクリックでは二重に開かない", async () => {
    const fetchSpy = mockFetch();
    const Page = await importPage();
    render(<Page />);
    await waitFor(() =>
      expect(
        screen.getByText("DL0001", { selector: "td" }),
      ).toBeInTheDocument(),
    );

    // 一覧の行(商談番号セルの行)をクリックする。未完了タスク表にも商談名が出るため、番号セルから行をたどる
    fireEvent.click(
      screen.getByText("DL0001", { selector: "td" }).closest("tr")!,
    );

    await waitFor(() =>
      expect(screen.getByText("🤝 商談 DL0001")).toBeInTheDocument(),
    );
    const detailCalls = fetchSpy.mock.calls.filter(
      ([u]) => String(u) === "/api/sales-deals/DL0001",
    );
    expect(detailCalls).toHaveLength(1);
  });

  it("プレビューのボタンを押しても行クリックは発火せず、フォームは開かない", async () => {
    mockFetch();
    const Page = await importPage();
    render(<Page />);
    await waitFor(() =>
      expect(screen.getByText("プレビュー")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("プレビュー"));

    await screen.findByRole("dialog", { name: "商談プレビュー" });
    expect(screen.queryByText("🤝 商談 DL0001")).toBeNull();
  });
});
