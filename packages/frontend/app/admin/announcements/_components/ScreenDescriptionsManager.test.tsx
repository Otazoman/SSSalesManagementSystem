import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScreenDescriptionsManager } from "./ScreenDescriptionsManager";
import { PermissionProvider } from "../../../context/permissioncontext";
import { ScreenDescriptionProvider } from "../../../context/screen-descriptions";
import { PageHeader } from "../../../_shared/ui/PageHeader";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let stored: { path: string; descriptionHtml: string }[] = [];

beforeEach(() => {
  stored = [{ path: "/master/units", descriptionHtml: "<p>単位の説明(設定済み)</p>" }];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/screen-descriptions" && method === "GET") return json(stored);
    if (url === "/api/screen-descriptions/preview") {
      return json({ html: JSON.parse(String(init?.body)).body });
    }
    if (url === "/api/screen-descriptions" && method === "PUT") {
      const body = JSON.parse(String(init?.body));
      stored = [
        ...stored.filter((d) => d.path !== body.path),
        { path: body.path, descriptionHtml: body.descriptionHtml },
      ];
      return json(body);
    }
    if (url.startsWith("/api/screen-descriptions?path=") && method === "DELETE") {
      const path = decodeURIComponent(url.split("=")[1]);
      stored = stored.filter((d) => d.path !== path);
      return json({ success: true });
    }
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const screens = [
  { title: "見積管理", icon: "📄", path: "/sales/quotes", resource: "sales_quotes", category: "daily_work" },
  { title: "単位マスタ", icon: "📐", path: "/master/units", resource: "master_units", category: "business_master" },
];

function renderManager(canUpdate = true, canDelete = true) {
  return render(
    <PermissionProvider value={{ user: null, flatScreens: screens, loading: false }}>
      <ScreenDescriptionProvider pathname="/admin/announcements" enabled>
        <ScreenDescriptionsManager canUpdate={canUpdate} canDelete={canDelete} />
      </ScreenDescriptionProvider>
    </PermissionProvider>,
  );
}

describe("ScreenDescriptionsManager", () => {
  it("画面の一覧を出し、設定済みの画面には印を付ける。絞り込みができる", async () => {
    renderManager();
    expect(await screen.findByText("設定済み")).toBeInTheDocument();
    expect(screen.getByText(/見積管理/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("画面を絞り込み"), "単位");
    expect(screen.queryByText(/見積管理/)).not.toBeInTheDocument();
    expect(screen.getByText(/単位マスタ/)).toBeInTheDocument();
  });

  it("未設定の画面を選んで説明を入力→保存すると、PUTして設定済みになる", async () => {
    renderManager();
    await userEvent.click(await screen.findByRole("button", { name: /見積管理/ }));
    expect(screen.getByText(/既定の説明が表示されています/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("本文(HTML)"), { target: { value: "<p>見積の新しい説明</p>" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/screen-descriptions",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ path: "/sales/quotes", descriptionHtml: "<p>見積の新しい説明</p>" }),
        }),
      ),
    );
    expect(await screen.findByText("画面の説明を保存しました")).toBeInTheDocument();
    expect(await screen.findAllByText("設定済み")).toHaveLength(2);
  });

  it("空のままでは保存できない。設定済みの画面は「既定の説明に戻す」で削除できる", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderManager();
    await userEvent.click(await screen.findByRole("button", { name: /単位マスタ/ }));
    expect(screen.getByLabelText("本文(HTML)")).toHaveValue("<p>単位の説明(設定済み)</p>");
    await userEvent.click(screen.getByRole("button", { name: "既定の説明に戻す" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/screen-descriptions?path=%2Fmaster%2Funits", { method: "DELETE", credentials: "include", headers: expect.anything(), body: undefined }),
    );
    expect(await screen.findByText("既定の説明に戻しました")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("設定済み")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled(); // 空
  });

  it("更新権限が無ければ編集・保存できず、削除権限が無ければ「既定に戻す」も出ない", async () => {
    renderManager(false, false);
    await userEvent.click(await screen.findByRole("button", { name: /単位マスタ/ }));
    expect(screen.getByLabelText("本文(HTML)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "既定の説明に戻す" })).not.toBeInTheDocument();
  });
});

describe("PageHeader と画面の説明", () => {
  const header = (pathname: string) => (
    <ScreenDescriptionProvider pathname={pathname} enabled>
      <PageHeader title="単位マスタ" description="既定の説明" />
    </ScreenDescriptionProvider>
  );

  it("説明が設定された画面では、既定の説明の代わりにそのHTMLを表示する", async () => {
    render(header("/master/units"));
    expect(await screen.findByText("単位の説明(設定済み)")).toBeInTheDocument();
    expect(screen.queryByText("既定の説明")).not.toBeInTheDocument();
  });

  it("末尾のスラッシュがあっても同じ画面として扱う", async () => {
    render(header("/master/units/"));
    expect(await screen.findByText("単位の説明(設定済み)")).toBeInTheDocument();
  });

  it("未設定の画面では、コードに書かれた既定の説明を表示する", async () => {
    render(header("/master/products"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("既定の説明")).toBeInTheDocument();
  });

  it("プロバイダー無し(公開ページ・テスト)でも既定の説明を表示する。取得に失敗しても同様", async () => {
    const { unmount } = render(<PageHeader title="t" description="既定の説明" />);
    expect(screen.getByText("既定の説明")).toBeInTheDocument();
    unmount();
    fetchMock.mockResolvedValueOnce(json({ message: "x" }, 500));
    render(header("/master/units"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("既定の説明")).toBeInTheDocument();
  });
});
