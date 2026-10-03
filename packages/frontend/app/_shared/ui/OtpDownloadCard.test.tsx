import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpDownloadCard } from "./OtpDownloadCard";

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function fileResponse(disposition?: string) {
  const headers = new Headers();
  if (disposition) headers.set("Content-Disposition", disposition);
  return {
    ok: true,
    headers,
    blob: async () => new Blob(["pdf"]),
  } as unknown as Response;
}

beforeEach(() => {
  params = new URLSearchParams("orderId=O1&attachmentId=A1");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:test");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const card = (
  props: Partial<React.ComponentProps<typeof OtpDownloadCard>> = {},
) => (
  <OtpDownloadCard
    title="📋 注文請書ダウンロード"
    apiBasePath="/api/sales-orders"
    idParam="orderId"
    fileNamePrefix="注文請書"
    {...props}
  />
);

describe("OtpDownloadCard", () => {
  it("メール入力→確認コード→ダウンロードの流れで、APIの場所とファイル名が props どおりになる", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "送信しました" }))
      .mockResolvedValueOnce(
        fileResponse("attachment; filename*=UTF-8''%E6%B3%A8%E6%96%87.pdf"),
      );
    render(card());

    expect(
      screen.getByRole("heading", { name: "📋 注文請書ダウンロード" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "a@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "確認コードを送信する" }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/sales-orders/download-request/O1/A1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@example.com" }),
      },
    );
    expect(await screen.findByText("✅ 送信しました")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("0000"), "123456");
    await user.click(
      screen.getByRole("button", { name: "確認してダウンロード" }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/sales-orders/download-verify/O1/A1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@example.com", otp: "123456" }),
      },
    );
    const link = await screen.findByRole("link", {
      name: /注文\.pdf をダウンロード/,
    });
    expect(link).toHaveAttribute("href", "blob:test");
    expect(link).toHaveAttribute("download", "注文.pdf");
  });

  it("ファイル名ヘッダーが無い時は「<ファイル名の接頭辞>_<ID>.pdf」になる", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(fileResponse());
    render(card());
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "a@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "確認コードを送信する" }),
    );
    await user.type(await screen.findByPlaceholderText("0000"), "1");
    await user.click(
      screen.getByRole("button", { name: "確認してダウンロード" }),
    );
    expect(
      await screen.findByRole("link", { name: /注文請書_O1\.pdf/ }),
    ).toBeInTheDocument();
  });

  it("URLにIDが無い時は警告を出し、入力・送信できない", () => {
    params = new URLSearchParams("orderId=O1"); // attachmentId なし
    render(card());
    expect(screen.getByText(/URLが不正です/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("you@example.com")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "確認コードを送信する" }),
    ).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("withAttachment=false(請求書など)は、IDだけで呼び出し、attachmentId は不要", async () => {
    const user = userEvent.setup();
    params = new URLSearchParams("billingId=B1");
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    render(
      card({
        apiBasePath: "/api/sales-billing",
        idParam: "billingId",
        fileNamePrefix: "請求書",
        withAttachment: false,
      }),
    );
    expect(screen.queryByText(/URLが不正です/)).not.toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "a@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "確認コードを送信する" }),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/sales-billing/download-request/B1",
    );
  });

  it("送信・検証のエラーを表示する。メールアドレスの入力し直しで最初に戻る", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ success: false, message: "送信に失敗しました(テスト)" }, false),
      )
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({ success: false, message: "コードが違います" }, false),
      );
    render(card());

    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "a@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "確認コードを送信する" }),
    );
    expect(
      await screen.findByText("⚠️ 送信に失敗しました(テスト)"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "確認コードを送信する" }),
    );
    await user.type(await screen.findByPlaceholderText("0000"), "1");
    await user.click(
      screen.getByRole("button", { name: "確認してダウンロード" }),
    );
    expect(await screen.findByText("⚠️ コードが違います")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "メールアドレスを入力し直す" }),
    );
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("you@example.com"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("⚠️ コードが違います")).not.toBeInTheDocument();
  });
});
