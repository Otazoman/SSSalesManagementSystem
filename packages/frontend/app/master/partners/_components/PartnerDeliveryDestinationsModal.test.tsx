import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartnerDeliveryDestinationsModal } from "./PartnerDeliveryDestinationsModal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PartnerDeliveryDestinationsModal", () => {
  it("マウント時に納品先一覧を取得して表示する", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse([
        {
          id: "DD-1",
          partnerId: "PARTNER-1",
          name: "東京支店",
          postalCode: "100-0001",
          address: "東京都千代田区千代田1-1",
          phone: "03-1234-5678",
          memo: null,
          status: "active",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <PartnerDeliveryDestinationsModal
        partnerId="PARTNER-1"
        partnerName="取引先1"
        canUpdate
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("東京支店")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/partner-delivery-destinations?partnerId=PARTNER-1"),
      expect.anything(),
    );
  });

  it("納品先を登録すると一覧が更新される", async () => {
    const user = userEvent.setup();
    let registered = false;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const u = url.toString();
      if (u.includes("/api/partner-delivery-destinations") && init?.method === "POST") {
        registered = true;
        return jsonResponse({ success: true, message: "納品先を登録しました" });
      }
      if (u.includes("/api/partner-delivery-destinations")) {
        return jsonResponse(
          registered
            ? [
                {
                  id: "DD-1",
                  partnerId: "PARTNER-1",
                  name: "大阪支店",
                  postalCode: null,
                  address: null,
                  phone: null,
                  memo: null,
                  status: "active",
                },
              ]
            : [],
        );
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <PartnerDeliveryDestinationsModal
        partnerId="PARTNER-1"
        partnerName="取引先1"
        canUpdate
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("登録済みの納品先がありません。")).toBeInTheDocument(),
    );

    await user.type(screen.getByPlaceholderText("納品先名(必須)"), "大阪支店");
    await user.click(screen.getByRole("button", { name: "＋ 納品先を追加" }));

    expect(await screen.findByText("納品先を登録しました")).toBeInTheDocument();
  });

  it("✕ボタンでonCloseが呼ばれる", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const onClose = vi.fn();

    render(
      <PartnerDeliveryDestinationsModal
        partnerId="PARTNER-1"
        partnerName="取引先1"
        canUpdate
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));

    expect(onClose).toHaveBeenCalled();
  });
});
