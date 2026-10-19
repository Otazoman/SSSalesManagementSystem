import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentCopyPickerModal } from "./DocumentCopyPickerModal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () =>
    jsonResponse([{ id: "SO-1", title: "過去の受注", totalAmount: 5500 }]),
  );
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 新規要望(2026-10-19): 見積・受注のヘッダーから過去の伝票を選んで複写する
describe("DocumentCopyPickerModal", () => {
  it("発注の再発注と同じく承認済みの伝票を一覧する", async () => {
    render(
      <DocumentCopyPickerModal
        title="📋 過去の受注から作成"
        listPath="/api/sales-orders"
        documentLabel="受注"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByText("過去の受注")).toBeInTheDocument();
    const url = fetchSpy.mock.calls[0][0].toString();
    expect(url).toContain("/api/sales-orders?status=APPROVED");
  });

  it("伝票を選ぶとそのIDで onSelect を呼び、モーダルを閉じる", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <DocumentCopyPickerModal
        title="📋 過去の受注から作成"
        listPath="/api/sales-orders"
        documentLabel="受注"
        onClose={onClose}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(await screen.findByText("過去の受注"));

    expect(onSelect).toHaveBeenCalledWith("SO-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("該当がなければその旨を表示する", async () => {
    fetchSpy.mockImplementation(async () => jsonResponse([]));
    render(
      <DocumentCopyPickerModal
        title="📋 過去の見積から作成"
        listPath="/api/quotes"
        documentLabel="見積"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("承認済みの見積が見つかりません。")).toBeInTheDocument(),
    );
  });
});
