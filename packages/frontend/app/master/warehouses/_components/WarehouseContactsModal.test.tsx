import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WarehouseContactsModal } from "./WarehouseContactsModal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const contact = {
  id: "WC-1",
  warehouseId: "W-1",
  name: "倉庫担当A",
  email: "a@example.com",
  phone: null,
  isEmailTarget: true,
  documentTypes: ["shipment_instruction"],
  memo: null,
  status: "active",
};

type RequestBody = { documentTypes?: string[]; status?: string };

function stubFetch() {
  const calls: { url: string; method: string; body: RequestBody }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: url.toString(),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body as string) : {},
      });
      if (url.toString().includes("/api/warehouse-contacts?")) {
        return jsonResponse([contact]);
      }
      return jsonResponse({ message: "OK" });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderModal() {
  render(
    <WarehouseContactsModal
      warehouseId="W-1"
      warehouseName="第一倉庫"
      canUpdate
      onClose={vi.fn()}
    />,
  );
}

describe("WarehouseContactsModal: メールで送る帳票(V-5)", () => {
  it("登録済みの連絡先に、メールで送る帳票を表示する", async () => {
    stubFetch();
    renderModal();
    expect(
      await screen.findByText(/メールで送る帳票: 出荷指示書/),
    ).toBeInTheDocument();
  });

  it("新規追加では、既定で全帳票にチェックが入り、外した帳票はdocumentTypesに含まれない", async () => {
    const calls = stubFetch();
    renderModal();
    await screen.findByText("倉庫担当A");

    const form = screen.getByPlaceholderText("メールアドレス").closest("form")!;
    expect(within(form).getByLabelText("出荷指示書")).toBeChecked();
    expect(within(form).getByLabelText("入荷指示書")).toBeChecked();

    await userEvent.type(
      screen.getByPlaceholderText("メールアドレス"),
      "new@example.com",
    );
    await userEvent.click(within(form).getByLabelText("入荷指示書"));
    await userEvent.click(
      screen.getByRole("button", { name: "＋ 連絡先を追加" }),
    );

    const post = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/api/warehouse-contacts/register"),
    );
    expect(post!.body.documentTypes).toEqual(["shipment_instruction"]);
  });

  it("「帳票を変更」で登録済みの連絡先の帳票を変更し、PUTで保存できる", async () => {
    const calls = stubFetch();
    renderModal();
    await userEvent.click(
      await screen.findByRole("button", { name: "帳票を変更" }),
    );

    // 追加フォームのチェック群と編集用のチェック群があり、編集用は後ろに表示される
    const boxes = screen.getAllByLabelText("入荷指示書");
    expect(boxes).toHaveLength(2);
    await userEvent.click(boxes[boxes.length - 1]);
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    const put = calls.find(
      (c) =>
        c.method === "PUT" && c.url.endsWith("/api/warehouse-contacts/WC-1"),
    );
    expect(put!.body.documentTypes).toEqual([
      "shipment_instruction",
      "receipt_instruction",
    ]);
    expect(put!.body.status).toBe("active");
  });
});
