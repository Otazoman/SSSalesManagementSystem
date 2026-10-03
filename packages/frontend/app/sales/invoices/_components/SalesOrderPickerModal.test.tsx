import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SalesOrderPickerModal } from "./SalesOrderPickerModal";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const orders = [
  { id: "SO-0001", title: "製品X 納入", partnerId: "P-1", status: "APPROVED", totalAmount: 1000 },
  { id: "SO-0002", title: "製品Y 納入", partnerId: "P-2", status: "APPROVED", totalAmount: 2000 },
];

// 一覧APIの検索(id・title)は「両方に一致」するものだけを返す(Backendと同じ)
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(url.toString(), "http://localhost");
      if (!u.pathname.startsWith("/api/sales-orders")) return jsonResponse([]);
      const id = u.searchParams.get("id");
      const title = u.searchParams.get("title");
      return jsonResponse(
        orders.filter((o) => (!id || o.id.includes(id)) && (!title || (o.title ?? "").includes(title))),
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SalesOrderPickerModal: BUG-064 受注の検索", () => {
  it("受注番号で検索すると見つかる", async () => {
    render(<SalesOrderPickerModal onClose={vi.fn()} onApply={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "SO-0002" } });

    await waitFor(() => expect(screen.queryByText("SO-0001")).not.toBeInTheDocument());
    expect(screen.getByText("SO-0002")).toBeInTheDocument();
  });

  it("件名で検索すると見つかる", async () => {
    render(<SalesOrderPickerModal onClose={vi.fn()} onApply={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "製品X" } });

    await waitFor(() => expect(screen.queryByText("SO-0002")).not.toBeInTheDocument());
    expect(screen.getByText("SO-0001")).toBeInTheDocument();
  });

  it("前回選んだ受注番号を初期値にして開いた時も、その受注が一覧に表示される(空にならない)", async () => {
    render(<SalesOrderPickerModal initialSalesOrderId="SO-0001" onClose={vi.fn()} onApply={vi.fn()} />);

    expect(await screen.findByText("SO-0001")).toBeInTheDocument();
  });
});
