import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

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

const BATCH_ROW = {
  id: "B-1",
  entryDate: "2026-09-15T00:00:00.000Z",
  description: "仕入[SR-1]",
  sourceType: "purchase_recognition",
  sourceRefId: "SR-1",
  eventType: "PURCHASE",
  totalDebitAmount: 11000,
  totalCreditAmount: 11000,
  reversalOfBatchId: null,
  correctionOfBatchId: null,
  memo: null,
  postedById: "EMP001",
  postedAt: "2026-09-15T00:00:00.000Z",
  type: "ORIGINAL",
  pairs: [] as unknown[],
};

const LINE = (id: string, side: string, accountCode: string, accountName: string) => ({
  id,
  batchId: "B-1",
  lineNo: id.endsWith("1") ? 1 : 2,
  side,
  accountCode,
  accountName,
  externalMappingCode: null,
  amount: 11000,
  taxCategoryCode: side === "DEBIT" ? "TAX_10" : null,
  taxRate: side === "DEBIT" ? 0.1 : null,
  itemId: null,
  itemName: side === "DEBIT" ? "品目A" : null,
  sourceRefItemId: null,
  memo: null,
});
const DEBIT_LINE = LINE("B-1-L1", "DEBIT", "ACC_OLD", "旧勘定科目");
const CREDIT_LINE = LINE("B-1-L2", "CREDIT", "2101", "買掛金");
BATCH_ROW.pairs = [{ amount: 11000, debit: DEBIT_LINE, credit: CREDIT_LINE }];

const BATCH_DETAIL = {
  ...BATCH_ROW,
  lines: [DEBIT_LINE, CREDIT_LINE],
  chain: [{ ...BATCH_ROW, lines: [DEBIT_LINE, CREDIT_LINE] }],
};

function buildFetchSpy() {
  return vi.fn(async (url: string) => {
    const u = url.toString();
    if (u.includes("/api/company-settings")) {
      return jsonResponse({ is_pagination_enabled: false });
    }
    if (u.includes("/api/accounts")) {
      return jsonResponse([{ code: "ACC_NEW", name: "新勘定科目" }]);
    }
    if (u.includes("/api/journal-batches/B-1")) {
      return jsonResponse(BATCH_DETAIL);
    }
    if (u.includes("/api/journal-batches")) {
      return jsonResponse([BATCH_ROW]);
    }
    return jsonResponse({});
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("JournalEditPage(権限ガード)", () => {
  it("canRead:falseの場合はAccessDeniedInlineを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions({ canRead: false }));
    vi.stubGlobal("fetch", buildFetchSpy());
    const Page = await importPage();

    render(<Page />);

    expect(screen.getByText("🔒 この画面を閲覧する権限がありません")).toBeInTheDocument();
  });
});

describe("JournalEditPage(一覧・詳細)", () => {
  it("一覧に「借方〇〇/貸方〇〇」の組を1行で表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    vi.stubGlobal("fetch", buildFetchSpy());
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("旧勘定科目")).toBeInTheDocument());
    const row = screen.getByText("旧勘定科目").closest("tr")!;
    expect(row).toHaveTextContent("買掛金");
    expect(row).toHaveTextContent("品目A / 税区分 TAX_10");
    expect(row.textContent!.match(/¥11,000/g)).toHaveLength(2);
  });

  it("科目名の欄にコードが入っている古い仕訳は、勘定科目マスタの名前とコードを表示する", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    const legacyDebit = { ...DEBIT_LINE, accountCode: "ACC_NEW", accountName: "ACC_NEW" };
    const fetchSpy = buildFetchSpy();
    const base = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation(async (url: string) =>
      url.toString().endsWith("/api/journal-batches") || url.toString().includes("/api/journal-batches?")
        ? jsonResponse([{ ...BATCH_ROW, pairs: [{ amount: 11000, debit: legacyDebit, credit: CREDIT_LINE }] }])
        : base(url),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("新勘定科目")).toBeInTheDocument());
    expect(screen.getByText("新勘定科目").closest("td")).toHaveTextContent("新勘定科目ACC_NEW");
  });

  it("詳細を開くと連鎖(元バッチ)が組の表で表示される", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    vi.stubGlobal("fetch", buildFetchSpy());
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("詳細・訂正")).toBeInTheDocument());
    fireEvent.click(screen.getByText("詳細・訂正"));

    await waitFor(() => expect(screen.getByText("✏️ この内容を訂正する")).toBeInTheDocument());
    expect(screen.getByText("借方合計")).toBeInTheDocument();
    expect(screen.getAllByText("旧勘定科目").length).toBeGreaterThanOrEqual(2);
  });

  it("訂正では、組の借方・貸方それぞれの勘定科目を選べる", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions());
    vi.stubGlobal("fetch", buildFetchSpy());
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("詳細・訂正")).toBeInTheDocument());
    fireEvent.click(screen.getByText("詳細・訂正"));
    await waitFor(() => expect(screen.getByText("✏️ この内容を訂正する")).toBeInTheDocument());
    fireEvent.click(screen.getByText("✏️ この内容を訂正する"));

    expect(screen.getByLabelText("借方の勘定科目(旧勘定科目)")).toBeInTheDocument();
    expect(screen.getByLabelText("貸方の勘定科目(買掛金)")).toBeInTheDocument();
  });

  it("canUpdate:falseの場合は訂正ボタンを表示しない", async () => {
    mockUsePagePermissions.mockReturnValue(basePermissions({ canUpdate: false }));
    vi.stubGlobal("fetch", buildFetchSpy());
    const Page = await importPage();

    render(<Page />);

    await waitFor(() => expect(screen.getByText("詳細・訂正")).toBeInTheDocument());
    fireEvent.click(screen.getByText("詳細・訂正"));

    await waitFor(() => expect(screen.getByText("借方合計")).toBeInTheDocument());
    expect(screen.queryByText("✏️ この内容を訂正する")).not.toBeInTheDocument();
  });
});
