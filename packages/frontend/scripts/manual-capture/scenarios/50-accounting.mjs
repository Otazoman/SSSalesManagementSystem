// 経理・統制(docs/manual/accounting/)のキャプチャ
import { openNewForm } from "../lib/scenario-helpers.mjs";

export const category = "accounting";

/** ボタンで画面(確認の表・モーダル)を開いて撮る。ボタンが無い(対象のデータが無い)場合は記録だけする */
async function openAndShot(h, button, name) {
  if (!(await openNewForm(h, { button, name }))) h.note(`「${button}」のボタンが無いため、${name} を撮影できない`);
}

export default [
  {
    id: "journal",
    title: "仕訳データ出力",
    path: "/accounting/journal",
    steps: async (h) => {
      await h.shot("list");
      // 作成前の仕訳の確認(保存はしない)
      await openAndShot(h, /^仕訳を確認$/, "preview");
      // 作成済みの仕訳(転記状況の「仕訳を見る」)
      await h.page.goto(h.page.url());
      await h.settle();
      await openAndShot(h, /仕訳を見る/, "posted");
    },
  },
  { id: "journal-rules", title: "仕訳ルールマスタ", path: "/accounting/journal-rules" },
  { id: "journal-export-format", title: "仕訳CSV出力フォーマット設定", path: "/accounting/journal-export-format" },
  {
    id: "journal-edit",
    title: "仕訳編集",
    path: "/accounting/journal-edit",
    steps: async (h) => {
      await h.shot("list");
      await openAndShot(h, /詳細・訂正/, "detail");
      // 訂正の入力欄を開くだけ(起票はしない)
      await openAndShot(h, /この内容を訂正する/, "correct");
    },
  },
];
