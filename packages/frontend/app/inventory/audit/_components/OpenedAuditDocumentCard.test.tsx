import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OpenedAuditDocumentCard, parseOpenedAuditDocumentKind } from "./OpenedAuditDocumentCard";

// REQ-016: 承認のプレビューから開く、棚卸・品質区分変更・廃棄・返品の参照用カード
afterEach(() => {
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("OpenedAuditDocumentCard", () => {
  it("種類の指定(棚卸)があれば、その API だけから取得して表示する。承認待ちでも開ける", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ id: "AU-1", status: "UNAPPROVED", itemId: "ITEM-A", theoreticalQuantity: 10, countedQuantity: 8, differenceQuantity: -2 }),
    );
    render(<OpenedAuditDocumentCard kind="audit" id="AU-1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText("ITEM-A")).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/stock-audits/AU-1");
    expect(screen.getByText("📄 棚卸:")).toBeTruthy();
    expect(screen.getByText("🟡 承認申請中")).toBeTruthy();
    expect(screen.getByText("-2")).toBeTruthy();
  });

  it("種類の指定が無ければ、棚卸→品質区分変更→廃棄→返品の順に探す", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stock-returns/RT-1")) {
        return json({ id: "RT-1", status: "APPROVED", direction: "OUTBOUND", quantity: 3, returnReason: "破損" });
      }
      return json({ message: "見つかりません" }, 404);
    });
    render(<OpenedAuditDocumentCard kind={null} id="RT-1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText("仕入先へ返品")).toBeTruthy());
    expect(screen.getByText("破損")).toBeTruthy();
    expect(fetchSpy.mock.calls.map((c) => String(c[0]).replace(/^.*\/api\//, ""))).toEqual([
      "stock-audits/RT-1",
      "stock-reclassifications/RT-1",
      "stock-disposals/RT-1",
      "stock-returns/RT-1",
    ]);
  });

  it("どれにも見つからなければエラーを表示する", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ message: "見つかりません" }, 404));
    render(<OpenedAuditDocumentCard kind={null} id="NONE" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("対象の棚卸/品質区分変更/廃棄/返品データが見つかりませんでした")).toBeTruthy(),
    );
  });

  it("openKind の値は、知っている種類だけを受け付ける", () => {
    expect(parseOpenedAuditDocumentKind("disposal")).toBe("disposal");
    expect(parseOpenedAuditDocumentKind("receipt")).toBeNull();
    expect(parseOpenedAuditDocumentKind(null)).toBeNull();
  });
});
