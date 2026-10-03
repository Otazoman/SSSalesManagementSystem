// 日常業務・在庫(docs/manual/inventory/)のキャプチャ。画面の上のタブを順に撮る
import { clickTabAndShot } from "../lib/scenario-helpers.mjs";

export const category = "inventory";

async function tabs(h, names) {
  await h.shot("list");
  for (const [tab, name] of names) await clickTabAndShot(h, tab, name);
}

export default [
  {
    id: "receiving",
    title: "入荷",
    path: "/inventory/receiving",
    steps: (h) =>
      tabs(h, [
        [/^📥?\s*入庫$/, "receipt"],
        [/入荷実績入力/, "actual"],
        [/実績履歴/, "history"],
        [/在庫照会/, "stocks"],
        [/検収書発行/, "acceptance"],
      ]),
  },
  {
    id: "shipping",
    title: "出荷",
    path: "/inventory/shipping",
    steps: (h) =>
      tabs(h, [
        [/^📤?\s*出庫$/, "shipment"],
        [/出荷実績入力/, "actual"],
        [/実績履歴/, "history"],
        [/在庫照会/, "stocks"],
        [/納品書発行/, "delivery-note"],
      ]),
  },
  {
    id: "audit",
    title: "在庫・棚卸管理",
    path: "/inventory/audit",
    steps: (h) =>
      tabs(h, [
        [/在庫照会/, "stocks"],
        [/返品履歴/, "returns"],
        [/廃棄履歴/, "disposals"],
        [/棚卸履歴/, "audit-history"],
      ]),
  },
  {
    // スマートフォンでの入庫(カメラでのスキャン)。カメラは起動しない(撮影環境にカメラが無いため)
    id: "receiving-phone",
    title: "入荷(スマートフォン)",
    path: "/inventory/receiving",
    viewport: "phone",
    steps: async (h) => {
      await clickTabAndShot(h, /^📥?\s*入庫$/, "receipt");
    },
  },
];
