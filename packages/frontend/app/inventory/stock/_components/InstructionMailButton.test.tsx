import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstructionMailButton } from "./InstructionMailButton";

// REQ-012: 指示書の案内メールは「メール送信」で、宛先を選んでから送る
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InstructionMailButton(REQ-012)", () => {
  it("倉庫の連絡先から宛先を選び、入荷指示書の send-email に送る", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/warehouse-contacts")) {
        return json([{ id: "WC-1", name: "倉庫担当", email: "wh@example.com", documentTypes: ["receipt_instruction"] }]);
      }
      if (url.includes("/send-email")) return json({ message: "宛先「wh@example.com」へのメール送信を予約しました" });
      return json([]);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const onResult = vi.fn();
    render(<InstructionMailButton kind="receipt" instructionId="RI-1" warehouseId="WH-1" onResult={onResult} />);

    await userEvent.click(screen.getByRole("button", { name: "✉️ メール送信" }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/warehouse-contacts?warehouseId=WH-1"))).toBe(true),
    );
    await userEvent.selectOptions(await screen.findByRole("combobox"), "WC-1");
    await userEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ message: "宛先「wh@example.com」へのメール送信を予約しました" }));
    const sendCall = fetchSpy.mock.calls.find(([u]) => String(u).includes("/api/receipt-instructions/RI-1/send-email"));
    expect(JSON.parse(String((sendCall as unknown as [string, RequestInit])[1].body))).toEqual({ recipientEmail: "wh@example.com" });
  });

  it("送信に失敗したら理由を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/send-email") ? json({ message: "先に出荷指示書の PDF を発行してください" }, 400) : json([]),
      ),
    );
    const onResult = vi.fn();
    render(<InstructionMailButton kind="shipment" instructionId="SI-1" warehouseId="WH-1" onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "✉️ メール送信" }));
    await userEvent.type(await screen.findByPlaceholderText("example@warehouse.com"), "to@example.com");
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ error: "先に出荷指示書の PDF を発行してください" }));
  });
});
