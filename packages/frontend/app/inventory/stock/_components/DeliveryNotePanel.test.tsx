import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeliveryNotePanel } from "./DeliveryNotePanel";
import type { ShipmentHeaderRecord } from "../_types";

// BUG-030: 納品書PDFを画面から作成(作り直し)でき、PDF が無くてもメール送信を選べる
const refetch = vi.fn(async () => {});
let headers: ShipmentHeaderRecord[] = [];

vi.mock("../_hooks/useInventoryHistory", () => ({
  useInventoryHistory: () => ({
    headers,
    partners: [{ id: "P-1", name: "テスト得意先" }],
    loading: false,
    detailError: "",
    refetch,
    status: "all",
    setStatus: vi.fn(),
    partnerId: "",
    setPartnerId: vi.fn(),
    dateFrom: "",
    setDateFrom: vi.fn(),
    dateTo: "",
    setDateTo: vi.fn(),
    clearFilters: vi.fn(),
    page: 1,
    setPage: vi.fn(),
    limit: 20,
    setLimit: vi.fn(),
    total: headers.length,
    totalPages: 1,
    sortBy: null,
    sortDirection: "asc",
    sortKeys: [],
    setSort: vi.fn(),
  }),
}));
// PERF-07 B-5: 納品書 PDF はブラウザで作って発行する(共通処理 issueReportPdf。描画は共有パッケージのテストで確かめている)
const issueReportPdf = vi.fn();
vi.mock("../../../_shared/report-pdf/issue-report-pdf", () => ({
  issueReportPdf: (...args: unknown[]) => issueReportPdf(...args),
}));

vi.mock("../../../_shared/hooks/use-pagination-setting", () => ({
  usePaginationSetting: () => ({ paginationEnabled: false }),
}));

function header(overrides: Partial<ShipmentHeaderRecord>): ShipmentHeaderRecord {
  return {
    id: "SH-1",
    shippedDate: "2026-09-28",
    status: "APPROVED",
    memo: null,
    partnerId: "P-1",
    createdBy: "EMP001",
    createdAt: "2026-09-28T00:00:00.000Z",
    salesOrderId: null,
    deliveryNoteR2Path: null,
    destinationWarehouseId: null,
    ...overrides,
  };
}

beforeEach(() => {
  headers = [];
  refetch.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeliveryNotePanel(納品書PDFの作成 BUG-030)", () => {
  it("PDF が無い出庫は「納品書PDFを作成」を押すと作成APIを呼び、一覧を読み直す。選択とメール送信もできる", async () => {
    headers = [header({})];
    issueReportPdf.mockResolvedValueOnce({ success: true, message: "納品書PDFを作成しました" });

    render(<DeliveryNotePanel />);
    expect(screen.queryByText("📄 納品書PDF")).toBeNull();
    expect(screen.getByText("未発行")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "" })).not.toBeDisabled();
    expect(screen.getByText("✉️ 送信")).toBeInTheDocument();

    fireEvent.click(screen.getByText("📄 納品書PDFを作成"));
    await waitFor(() =>
      expect(issueReportPdf).toHaveBeenCalledWith("/api/stock-shipments", "SH-1", expect.anything()),
    );
    await waitFor(() => expect(screen.getByText("納品書PDFを作成しました")).toBeInTheDocument());
    expect(refetch).toHaveBeenCalled();
  });

  it("PDF がある出庫は、表示のボタンと「PDFを作り直す」を出す", () => {
    headers = [header({ deliveryNoteR2Path: "inventory-documents/delivery-notes/SH-1/delivery_note.pdf" })];
    render(<DeliveryNotePanel />);
    expect(screen.getByText("📄 納品書PDF")).toBeInTheDocument();
    expect(screen.getByText("🔄 PDFを作り直す")).toBeInTheDocument();
    expect(screen.queryByText("未発行")).toBeNull();
  });

  it("作成に失敗した場合は、理由を表示する", async () => {
    headers = [header({})];
    issueReportPdf.mockRejectedValueOnce(new Error("明細の無い出庫には、納品書を作成できません"));
    render(<DeliveryNotePanel />);
    fireEvent.click(screen.getByText("📄 納品書PDFを作成"));
    await waitFor(() => expect(screen.getByText("明細の無い出庫には、納品書を作成できません")).toBeInTheDocument());
  });

  it("未確定の出庫・得意先の無い出庫には、作成のボタンを出さない", () => {
    headers = [header({ id: "SH-2", status: "UNAPPROVED" }), header({ id: "SH-3", partnerId: null })];
    render(<DeliveryNotePanel />);
    expect(screen.queryByText("📄 納品書PDFを作成")).toBeNull();
  });
});
