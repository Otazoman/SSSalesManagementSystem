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
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// 取込後の再取得で担当が反映されることを確認するため、owners は呼び出しごとに差し替えられる
function mockFetch(opts: { owners?: unknown[]; importResponse?: { status: number; body: unknown } } = {}) {
  let owners = opts.owners ?? [];
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const u = url.toString();
    if (init?.method === "POST" && u.includes("/api/progress/stage-owners/bulk-register")) {
      const res = opts.importResponse ?? { status: 200, body: { success: true, message: "工程の既定担当を反映しました(設定1件・未設定に戻す0件)" } };
      if (res.status === 200) owners = [{ stageKey: "billing", assigneeType: "USER", assigneeRef: "EMP001", assigneeName: "営業太郎" }];
      return jsonResponse(res.body, res.status);
    }
    if (u.includes("/api/progress/stage-owners/csv-download")) return new Response("stageKey\n", { status: 200 });
    if (u.includes("/api/progress/stage-owners")) return jsonResponse(owners);
    if (u.includes("/api/users")) return jsonResponse([{ employeeNumber: "EMP001", name: "営業太郎", isActive: true }]);
    if (u.includes("/api/roles")) return jsonResponse([{ id: "ROLE-1", name: "出荷担当" }]);
    if (u.includes("/api/departments")) return jsonResponse([]);
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function chooseFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["stageKey\n"], "owners.csv", { type: "text/csv" })] } });
}

beforeEach(() => {
  mockUsePagePermissions.mockReturnValue({ canRead: true, canUpdate: true, loading: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ProgressStageOwnersPage: CSVダウンロード・取込", () => {
  it("更新権限があれば「CSVダウンロード」「CSVインポート」を表示し、閲覧のみなら出力だけを表示する", async () => {
    mockFetch();
    const Page = await importPage();
    const { unmount } = render(<Page />);
    await waitFor(() => expect(screen.getByText("CSVダウンロード")).toBeInTheDocument());
    expect(screen.getByText("CSVインポート")).toBeInTheDocument();
    unmount();

    mockUsePagePermissions.mockReturnValue({ canRead: true, canUpdate: false, loading: false });
    mockFetch();
    const Page2 = await importPage();
    render(<Page2 />);
    await waitFor(() => expect(screen.getByText("CSVダウンロード")).toBeInTheDocument());
    expect(screen.queryByText("CSVインポート")).toBeNull();
  });

  it("「CSVダウンロード」でstage-owners/csv-downloadを取得してダウンロードする", async () => {
    const spy = mockFetch();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const Page = await importPage();
    render(<Page />);
    await waitFor(() => expect(screen.getByText("CSVダウンロード")).toBeInTheDocument());

    fireEvent.click(screen.getByText("CSVダウンロード"));

    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u) === "/api/progress/stage-owners/csv-download")).toBe(true));
  });

  it("CSVを選ぶとbulk-registerへPOSTし、成功メッセージを表示して、取込後の設定を画面に反映する", async () => {
    const spy = mockFetch();
    const Page = await importPage();
    const { container } = render(<Page />);
    await waitFor(() => expect(screen.getByText("CSVインポート")).toBeInTheDocument());

    chooseFile(container);

    await waitFor(() => expect(screen.getByText("工程の既定担当を反映しました(設定1件・未設定に戻す0件)")).toBeInTheDocument());
    const call = spy.mock.calls.find(([u]) => String(u).includes("/bulk-register"))!;
    expect(call[1]).toMatchObject({ method: "POST" });
    expect((call[1]!.body as FormData).get("file")).toBeInstanceOf(File);
    // 取込後に担当設定を取得し直し、請求の行が「担当者(社員マスタ)/ 営業太郎」に変わる
    await waitFor(() => expect(screen.getAllByRole("combobox").some((el) => (el as HTMLSelectElement).value === "EMP001")).toBe(true));
  });

  it("不正な行がある場合は複数行のエラーを表示し、閉じることができる", async () => {
    mockFetch({
      importResponse: { status: 400, body: { success: false, message: "CSVに不正な行があるため、1件も反映していません(2件)\n3行目: 工程が不正\n4行目: 担当が不正" } },
    });
    const Page = await importPage();
    const { container } = render(<Page />);
    await waitFor(() => expect(screen.getByText("CSVインポート")).toBeInTheDocument());

    chooseFile(container);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("3行目: 工程が不正");
    expect(alert).toHaveTextContent("4行目: 担当が不正");
    fireEvent.click(screen.getByText("閉じる"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
