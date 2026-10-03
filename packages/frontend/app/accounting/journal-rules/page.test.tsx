import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

function basePermissions(overrides: Record<string, unknown> = {}) {
  return { canRead: true, canUpdate: true, loading: false, ...overrides };
}

const EMPTY_RULE = (eventType: string) => ({
  eventType,
  variableAccountPriority: "ITEM_MASTER_FIRST",
  variableAccountFallbackCode: null,
  prepaidAccountCode: null,
  advanceReceivedAccountCode: null,
  cashAccountCode: null,
  payableAccountCode: null,
  receivableAccountCode: null,
  taxAccountCode: null,
  enabled: false,
  memo: null,
  updatedBy: null,
  updatedAt: null,
  patterns:
    eventType === "SALES"
      ? [
          { documentType: "SALE", lineKind: "BODY", debitFromItem: false, debitAccountCode: null, creditFromItem: true, creditAccountCode: null },
          { documentType: "SALE", lineKind: "TAX", debitFromItem: false, debitAccountCode: null, creditFromItem: false, creditAccountCode: null },
          { documentType: "RETURN", lineKind: "BODY", debitFromItem: true, debitAccountCode: null, creditFromItem: false, creditAccountCode: null },
        ]
      : [{ documentType: "DEFAULT", lineKind: "BODY", debitFromItem: false, debitAccountCode: null, creditFromItem: false, creditAccountCode: null }],
});

function mockFetches(fetchSpy: ReturnType<typeof vi.fn>) {
  fetchSpy.mockImplementation(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/journal-posting-rules")) {
      return jsonResponse(
        [
          "PREPAYMENT",
          "PURCHASE",
          "ADVANCE_RECEIPT",
          "SALES",
          "RECEIPT",
          "DISBURSEMENT",
        ].map(EMPTY_RULE),
      );
    }
    if (u.includes("/api/accounts")) {
      return jsonResponse([{ code: "5101", name: "仕入高" }]);
    }
    return jsonResponse([]);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("JournalPostingRulesPage(権限ガード)", () => {
  it("権限確認中はLoadingGateを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions({ loading: true }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions({ canRead: false }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });
});

describe("JournalPostingRulesPage(表示)", () => {
  it("6つの会計事象すべてのセクションを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("PREPAYMENT")).toBeInTheDocument());
    expect(screen.getByText("PURCHASE")).toBeInTheDocument();
    expect(screen.getByText("ADVANCE_RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("SALES")).toBeInTheDocument();
    expect(screen.getByText("RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("DISBURSEMENT")).toBeInTheDocument();
  });

  it("canUpdate:falseの場合は閲覧のみの案内を表示し、保存ボタンを無効化する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions({ canUpdate: false }));
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("PREPAYMENT")).toBeInTheDocument());
    expect(
      screen.getByText("この画面は閲覧のみ可能です(変更には更新権限が必要です)。"),
    ).toBeInTheDocument();
    const saveButtons = screen.getAllByText(/この事象.*の設定を保存/);
    saveButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it("組ごとに借方・貸方の勘定科目を選ぶ欄を出す(品目に連動する側は「品目の科目を使う」付き)", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const fetchSpy = vi.fn();
    mockFetches(fetchSpy);
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("SALES")).toBeInTheDocument());
    expect(screen.getByLabelText("売上本体(明細の税抜金額)の借方")).toBeInTheDocument();
    expect(screen.getByLabelText("売上本体(明細の税抜金額)の貸方")).toBeInTheDocument();
    expect(screen.getByLabelText("返品本体(明細の税抜金額)の借方")).toBeInTheDocument();
    // 品目に連動しない4事象は「金額」の組が1つずつ
    expect(screen.getAllByLabelText("金額の借方")).toHaveLength(4);
    // 売上の貸方・返品の借方(品目に連動する側)だけチェックが入っている
    const itemChecks = screen.getAllByLabelText("品目の科目を使う") as HTMLInputElement[];
    expect(itemChecks.filter((c) => c.checked)).toHaveLength(2);
  });
});
