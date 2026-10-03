import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mockUsePagePermissions = vi.fn();
vi.mock("../../hooks/use-page-permission", () => ({
  usePagePermissions: () => mockUsePagePermissions(),
}));

import { DocumentCompletionControl } from "./DocumentCompletionControl";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(initial: string | null = null, putStatus = 200) {
  const spy = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      return putStatus === 200 ? jsonResponse({ success: true }) : jsonResponse({ message: "保存に失敗" }, putStatus);
    }
    return jsonResponse({ stageKey: "quote", documentId: "Q-1", forcedState: initial });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const putCalls = (spy: ReturnType<typeof mockFetch>) => spy.mock.calls.filter(([, init]) => init?.method === "PUT");

beforeEach(() => {
  mockUsePagePermissions.mockReturnValue({ canUpdate: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DocumentCompletionControl", () => {
  it("伝票番号が無い(新規起票中)場合は何も表示せず、APIも呼ばない", () => {
    const spy = mockFetch();

    const { container } = render(<DocumentCompletionControl stageKey="quote" documentId={null} />);

    expect(container).toBeEmptyDOMElement();
    expect(spy).not.toHaveBeenCalled();
  });

  it("現在の設定を取得して表示する", async () => {
    const spy = mockFetch("COMPLETED");

    render(<DocumentCompletionControl stageKey="quote" documentId="Q-1" />);

    const select = screen.getByLabelText("進捗確認での完了状態") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("COMPLETED"));
    expect(String(spy.mock.calls[0][0])).toBe("/api/document-completion/quote/Q-1");
  });

  it("選択を変えるとPUTで保存し、自動判定を選ぶとforcedState=nullで解除する", async () => {
    const spy = mockFetch("COMPLETED");
    render(<DocumentCompletionControl stageKey="quote" documentId="Q-1" />);
    const select = screen.getByLabelText("進捗確認での完了状態") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("COMPLETED"));

    fireEvent.change(select, { target: { value: "IN_PROGRESS" } });
    await waitFor(() => expect(screen.getByText("進捗確認の完了状態を更新しました")).toBeInTheDocument());
    expect(putCalls(spy)[0][1]!.body).toBe(JSON.stringify({ forcedState: "IN_PROGRESS" }));
    expect(select.value).toBe("IN_PROGRESS");

    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(putCalls(spy)).toHaveLength(2));
    expect(putCalls(spy)[1][1]!.body).toBe(JSON.stringify({ forcedState: null }));
  });

  it("更新権限がない場合は変更できない(表示のみ)", async () => {
    mockUsePagePermissions.mockReturnValue({ canUpdate: false });
    mockFetch("IN_PROGRESS");

    render(<DocumentCompletionControl stageKey="quote" documentId="Q-1" />);

    const select = screen.getByLabelText("進捗確認での完了状態") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("IN_PROGRESS"));
    expect(select).toBeDisabled();
    expect(screen.getByText(/更新権限がないため変更できません/)).toBeInTheDocument();
  });

  it("保存に失敗した場合はエラーを表示する", async () => {
    mockFetch(null, 500);
    render(<DocumentCompletionControl stageKey="quote" documentId="Q-1" />);
    const select = screen.getByLabelText("進捗確認での完了状態") as HTMLSelectElement;
    await waitFor(() => expect(select).not.toBeDisabled());

    fireEvent.change(select, { target: { value: "COMPLETED" } });

    await waitFor(() => expect(screen.getByText("保存に失敗")).toBeInTheDocument());
  });
});
