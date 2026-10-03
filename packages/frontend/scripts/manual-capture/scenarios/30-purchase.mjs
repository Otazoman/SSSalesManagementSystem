// 日常業務・購買(docs/manual/purchase/)のキャプチャ
import { listAndNewForm } from "../lib/scenario-helpers.mjs";

export const category = "purchase";

export default [
  { id: "requisitions", title: "購買申請", path: "/purchase/requisitions", steps: (h) => listAndNewForm(h, { button: /購買申請を新規登録/ }) },
  { id: "orders", title: "発注管理", path: "/purchase/orders", steps: (h) => listAndNewForm(h, { button: /発注を新規登録/ }) },
  { id: "receipts", title: "仕入管理", path: "/purchase/receipts", steps: (h) => listAndNewForm(h, { button: /仕入を新規計上/ }) },
  { id: "payment", title: "支払管理", path: "/purchase/payment", steps: (h) => listAndNewForm(h, { button: /支払を新規登録/ }) },
];
