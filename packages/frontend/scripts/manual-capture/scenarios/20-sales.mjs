// 日常業務・販売(docs/manual/sales/)のキャプチャ
import { clickTabAndShot, listAndNewForm } from "../lib/scenario-helpers.mjs";

export const category = "sales";

export default [
  { id: "progress", title: "進捗確認(見積〜支払)", path: "/progress" },
  { id: "deals", title: "商談管理", path: "/sales/deals", steps: (h) => listAndNewForm(h, { button: /商談を登録/ }) },
  { id: "quotes", title: "見積管理", path: "/sales/quotes", steps: (h) => listAndNewForm(h, { button: /見積を新規登録/ }) },
  { id: "orders", title: "受注管理", path: "/sales/orders", steps: (h) => listAndNewForm(h, { button: /受注を新規登録/ }) },
  { id: "invoices", title: "売上管理", path: "/sales/invoices", steps: (h) => listAndNewForm(h, { button: /売上を新規計上/ }) },
  {
    id: "billing",
    title: "請求管理",
    path: "/sales/billing",
    steps: async (h) => {
      await listAndNewForm(h, { button: /請求を新規登録/ });
      await h.page.goto(h.page.url());
      await h.settle();
      await clickTabAndShot(h, /入金\(単体入金\)/, "cash-receipts");
    },
  },
];
