import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteLostControl } from "./QuoteLostControl";
import { todayJst } from "../../../_shared/jst-date";

// REQ-015: 見積の失注・失注の取消
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuoteLostControl", () => {
  it("承認済みの見積は「失注にする」で失注日(既定は今日)・理由を入れて送る", async () => {
    const fetchSpy = vi.fn(async () => json({ message: "見積を失注にしました" }));
    vi.stubGlobal("fetch", fetchSpy);
    const onChanged = vi.fn();
    render(<QuoteLostControl quoteId="QT-1" status="APPROVED" onChanged={onChanged} />);

    await userEvent.click(screen.getByRole("button", { name: "⚫ 失注にする" }));
    expect(screen.getByLabelText("失注日")).toHaveValue(todayJst());
    await userEvent.type(screen.getByLabelText("失注理由"), "価格");
    await userEvent.click(screen.getByRole("button", { name: "失注にする" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("見積を失注にしました"));
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/quotes/QT-1/mark-lost");
    expect(JSON.parse(String(init.body))).toEqual({ lostDate: todayJst(), lostReason: "価格" });
  });

  it("失注の見積は失注日・理由を出し、取り消せる。失敗したら理由を出す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "取り消せません" }, 400)));
    const onChanged = vi.fn();
    render(<QuoteLostControl quoteId="QT-1" status="LOST" lostDate="2026-11-15" lostReason="価格" onChanged={onChanged} />);
    expect(screen.getByText("2026-11-15")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "↩ 失注を取り消す" }));
    expect(await screen.findByText("取り消せません")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("下書き・承認申請中の見積では何も出さない", () => {
    const { container } = render(<QuoteLostControl quoteId="QT-1" status="DRAFT" onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
