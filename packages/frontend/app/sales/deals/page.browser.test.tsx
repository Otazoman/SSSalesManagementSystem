import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PermissionProvider } from "../../context/permissioncontext";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
  isWithinViewport,
} from "../../../test-support/responsive";

// 実ブラウザ: 商談管理の一覧・登録/編集モーダルが、スマホ・タブレット・PCで横にはみ出さず、
// モーダルの操作ボタンが常に画面内にあり、スマホの入力欄は16px以上になる
// 権限は本物のフック+コンテキストで、管理者(全操作可)として与える
vi.mock("next/navigation", () => ({
  usePathname: () => "/sales/deals",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

function withAdmin(ui: React.ReactElement) {
  const user: any = { roleId: "admin", permissions: [], departments: [] };
  return (
    <PermissionProvider value={{ user, flatScreens: [], loading: false }}>
      {ui}
    </PermissionProvider>
  );
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const deal = {
  id: "DL0001",
  partnerId: "PR-1",
  partnerName: "サンプル見込み商事",
  title: "初回ヒアリング(長い商談名のサンプル)",
  dealDate: "2026-09-10",
  startTime: "10:00",
  endTime: "11:30",
  location: null,
  status: "OPEN",
  ownerEmployeeNumber: "EMP001",
  ownerName: "営業 太郎",
  attendeeNames: ["見込客の佐藤", "未登録の田中"],
  taskCount: 2,
  openTaskCount: 1,
  attachmentCount: 1,
  quoteIds: ["Q-1"],
};
const openTask = {
  id: "T-1",
  dealId: "DL0001",
  dealTitle: deal.title,
  partnerName: deal.partnerName,
  title: "見積提出",
  dueDate: "2026-09-17",
  assigneeEmployeeNumber: "EMP001",
  assigneeName: "営業 太郎",
  isDone: false,
};
const detail = {
  ...deal,
  memo: "予算感のメモ",
  attendees: [
    {
      id: "A-1",
      kind: "PROSPECT_CONTACT",
      refId: "PC-1",
      name: "見込客の佐藤",
      note: "情報システム部",
    },
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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (u.includes("/api/sales-deals/tasks")) return json([openTask]);
      if (u.includes("/api/sales-deals/attendee-candidates"))
        return json({
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
      if (u.includes("/api/sales-deals/quote-candidates"))
        return json([
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
        return json(detail);
      if (u.includes("/api/sales-deals")) return json([deal]);
      if (u.includes("/api/partners"))
        return json([
          { id: "PR-1", name: "サンプル見込み商事", type: "PROSPECT" },
        ]);
      if (u.includes("/api/users"))
        return json([
          { employeeNumber: "EMP001", name: "営業 太郎", isActive: true },
        ]);
      return json([]);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const SIZES = [
  ["phone", WIDTHS.phone, 800],
  ["tablet", WIDTHS.tablet, 1024],
  ["desktop", 990, 800],
] as const;

describe.each(SIZES)("商談管理(%s)", (_n, width, height) => {
  it("一覧: 横にはみ出さない(表は枠内でスクロール)", async () => {
    await setWidth(width, height);
    const { default: Page } = await import("./page");
    render(withAdmin(<Page />));
    await waitFor(() =>
      expect(
        screen.getAllByText("初回ヒアリング(長い商談名のサンプル)").length,
      ).toBeGreaterThan(0),
    );
    expect(pageOverflowsHorizontally()).toBe(false);
  });

  it("編集モーダル: 画面内に収まり、下部のボタンが見える。ページは横にはみ出さない", async () => {
    await setWidth(width, height);
    const { default: Page } = await import("./page");
    render(withAdmin(<Page />));
    await waitFor(() => expect(screen.getByText("編集")).toBeInTheDocument());
    fireEvent.click(screen.getByText("編集"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(screen.getByDisplayValue("予算感のメモ")).toBeInTheDocument(),
    );
    const panel = dialog.firstElementChild as HTMLElement;
    expect(isWithinViewport(panel)).toBe(true);
    expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(
      height * 0.9 + 1,
    );
    for (const name of ["キャンセル", "保存"]) {
      expect(isWithinViewport(screen.getByRole("button", { name }))).toBe(true);
    }
    expect(pageOverflowsHorizontally()).toBe(false);
  });
});

describe("商談管理の入力欄(スマホ)", () => {
  it("モーダル内の入力欄・選択欄は16px以上(iOSの自動拡大を防ぐ)", async () => {
    await setWidth(WIDTHS.phone, 800);
    const { default: Page } = await import("./page");
    render(withAdmin(<Page />));
    await waitFor(() => expect(screen.getByText("編集")).toBeInTheDocument());
    fireEvent.click(screen.getByText("編集"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(screen.getByDisplayValue("予算感のメモ")).toBeInTheDocument(),
    );
    const fields = Array.from(
      dialog.querySelectorAll(
        "input:not([type=file]):not([type=checkbox]), select, textarea",
      ),
    );
    expect(fields.length).toBeGreaterThan(6);
    const small = fields.filter(
      (el) => parseFloat(getComputedStyle(el).fontSize) < 16,
    );
    expect(small.map((el) => el.outerHTML.slice(0, 90))).toEqual([]);
  });
});
