import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { TemporaryHoldingsPanel } from "./TemporaryHoldingsPanel";

// REQ-011(2): 一時保管のタブ
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const HOLDING = {
  id: "TH-1",
  category: "CUSTODY",
  itemName: "預りの治具",
  spec: "A型",
  quantity: 3,
  pendingQuantity: -1,
  unitName: "個",
  warehouseId: "WH1",
  locationId: null,
  sourceType: "PURCHASE_ORDER",
  sourceId: "PO-1",
  sourceItemId: "POI-1",
  partnerId: "P-1",
  receivedDate: "2026-11-01T00:00:00.000Z",
  plannedReleaseDate: "2026-11-02T00:00:00.000Z",
  status: "HOLDING",
};

function stubFetch(calls: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/warehouses")) return json([{ id: "WH1", name: "本社倉庫" }]);
      if (url.includes("/api/partners")) return json([{ id: "P-1", name: "取引先1" }]);
      if (url.includes("/api/temporary-holdings")) return json([HOLDING]);
      return json([]);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TemporaryHoldingsPanel(REQ-011(2))", () => {
  it("一覧に区分・品名・数量・承認待ち・保管場所・元の伝票・取引先を出し、払出予定日を過ぎたものを赤で出す", async () => {
    stubFetch();
    render(<TemporaryHoldingsPanel canCreate canDelete />);
    await waitFor(() => expect(screen.getByText("預りの治具")).toBeInTheDocument());
    const inCell = (text: string) => screen.getAllByText(text).some((el) => el.tagName === "TD");
    expect(inCell("預り品")).toBe(true);
    expect(screen.getByText("承認待ち -1")).toBeInTheDocument();
    expect(inCell("本社倉庫")).toBe(true);
    expect(screen.getByText("発注 PO-1")).toBeInTheDocument();
    expect(screen.getByText("取引先1")).toBeInTheDocument();
    expect(screen.getByText("予定日を過ぎています")).toBeInTheDocument();
  });

  it("区分で絞り込むと、一覧の API に区分を付けて読み直す", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    render(<TemporaryHoldingsPanel canCreate canDelete />);
    await waitFor(() => expect(screen.getByText("預りの治具")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("区分"), { target: { value: "OWN" } });
    await waitFor(() => expect(calls.some((u) => u.includes("/api/temporary-holdings?") && u.includes("category=OWN"))).toBe(true));
  });

  it("登録の権限が無ければ「受け入れる」を出さない", async () => {
    stubFetch();
    render(<TemporaryHoldingsPanel canCreate={false} canDelete={false} />);
    await waitFor(() => expect(screen.getByText("預りの治具")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /受け入れる/ })).not.toBeInTheDocument();
  });
});
