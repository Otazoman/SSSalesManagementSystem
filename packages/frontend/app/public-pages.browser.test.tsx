import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
  isWithinViewport,
} from "../test-support/responsive";

import LoginPage from "./login/page";
import SetupInitAdminPage from "./setup-init-admin/page";
import ForgotPasswordPage from "./forgot-password/page";
import ForcePasswordChangePage from "./force-password-change/page";
import PasswordResetPage from "./password-reset/page";
import QuoteDownloadPage from "./quote-download/page";
import OrderDownloadPage from "./order-download/page";
import PurchaseOrderDownloadPage from "./purchase-order-download/page";
import AcceptanceInspectionDownloadPage from "./acceptance-inspection-download/page";
import SalesInvoiceDownloadPage from "./sales-invoice-download/page";
import BillingDownloadPage from "./billing-download/page";
import ShipmentInstructionDownloadPage from "./shipment-instruction-download/page";
import ReceiptInstructionDownloadPage from "./receipt-instruction-download/page";
import DeliveryNoteDownloadPage from "./delivery-note-download/page";

// 実ブラウザ: ログイン前に開く公開ページ(認証系5+ダウンロード系9)を、スマホ・タブレット・PCで実際に描画し、
// 横にはみ出さない・カードの上端が切れない・入力欄は16px以上(スマホ)・送信ボタンは44px以上(スマホ)を確認する
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/",
  useSearchParams: () =>
    new URLSearchParams(
      "token=T&quoteId=Q1&orderId=O1&receiptId=R1&invoiceId=I1&billingId=B1&instructionId=X1&attachmentId=A1",
    ),
}));

beforeEach(() => {
  // 初期設定・初回パスワード変更画面が最初に呼ぶAPIだけ、画面を表示できる応答にする
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("/api/users/count")
        ? { totalUsers: 0 }
        : url.includes("/api/auth/profile")
          ? { id: "u1", name: "テスト 太郎" }
          : {};
      return {
        ok: true,
        json: async () => body,
        headers: new Headers(),
      } as unknown as Response;
    }),
  );
});

const PAGES: [string, ComponentType][] = [
  ["login", LoginPage],
  ["setup-init-admin", SetupInitAdminPage],
  ["forgot-password", ForgotPasswordPage],
  ["force-password-change", ForcePasswordChangePage],
  ["password-reset", PasswordResetPage],
  ["quote-download", QuoteDownloadPage],
  ["order-download", OrderDownloadPage],
  ["purchase-order-download", PurchaseOrderDownloadPage],
  ["acceptance-inspection-download", AcceptanceInspectionDownloadPage],
  ["sales-invoice-download", SalesInvoiceDownloadPage],
  ["billing-download", BillingDownloadPage],
  ["shipment-instruction-download", ShipmentInstructionDownloadPage],
  ["receipt-instruction-download", ReceiptInstructionDownloadPage],
  ["delivery-note-download", DeliveryNoteDownloadPage],
];

const SIZES = [
  ["phone", WIDTHS.phone, 667],
  ["tablet", WIDTHS.tablet, 1024],
  ["desktop", WIDTHS.desktop, 800],
] as const;

describe.each(PAGES)("公開ページ %s", (_name, Page) => {
  it.each(SIZES)(
    "%s: 横にはみ出さず、カードが切れず、スマホでは入力欄16px以上・送信ボタン44px以上",
    async (_size, width, height) => {
      await setWidth(width, height);
      const { container } = render(<Page />);
      await waitFor(() => expect(container.querySelector("h1")).not.toBeNull());

      const scroller = container.firstElementChild as HTMLElement;
      const card = container
        .querySelector("h1")!
        .closest("form, div.max-w-md") as HTMLElement;

      expect(pageOverflowsHorizontally()).toBe(false);
      expect(isWithinViewport(card)).toBe(true);
      // 内容が画面より高くても、上端は切れない(スクロールで下端まで届く)
      expect(scroller.scrollTop).toBe(0);
      expect(card.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);

      if (width < 640) {
        for (const input of Array.from(container.querySelectorAll("input"))) {
          expect(
            parseFloat(getComputedStyle(input).fontSize),
            "入力欄の文字サイズ",
          ).toBeGreaterThanOrEqual(16);
        }
        for (const btn of Array.from(
          container.querySelectorAll('button[type="submit"], a[download]'),
        )) {
          expect(
            btn.getBoundingClientRect().height,
            "送信ボタンの高さ",
          ).toBeGreaterThanOrEqual(44);
        }
      }
    },
  );
});

describe("内容が画面より高い公開ページ(初期設定・スマホ)", () => {
  it("上端が切れず、外枠の縦スクロールで下端のボタンまで届く", async () => {
    await setWidth(WIDTHS.phone, 667);
    const { container } = render(<SetupInitAdminPage />);
    await waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
    const scroller = container.firstElementChild as HTMLElement;
    // 前提: 実際に画面より高い(この条件でないとクリップの検証にならない)
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    expect(
      container.querySelector("h1")!.getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(0);
    scroller.scrollTop = scroller.scrollHeight;
    const submit = container.querySelector(
      'button[type="submit"]',
    ) as HTMLElement;
    expect(submit.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().bottom + 1,
    );
  });
});
