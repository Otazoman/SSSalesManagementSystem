// 基本マスタ設定(docs/manual/admin/)のキャプチャ
import { clickTabAndShot, listAndNewForm, openNewForm, overrideFieldsByLabel } from "../lib/scenario-helpers.mjs";

export const category = "admin";

// 会社・システム設定は実際の値を写さないよう、表示だけ架空の値にする(保存はしない)
const SAMPLE_COMPANY = {
  郵便番号: "000-0000",
  会社所在地: "東京都サンプル区サンプル町1-2-3",
  代表電話番号: "03-0000-0000",
  FAX番号: "03-0000-0001",
  登録番号: "T0000000000000",
  SMTPホスト名: "smtp.example.com",
  SMTP認証ユーザー名: "no-reply@example.com",
  送信元メールアドレス: "no-reply@example.com",
  システム本番環境URL: "https://sms.example.com",
};

export default [
  {
    id: "company-settings",
    title: "会社・システム設定",
    path: "/admin/company-settings",
    steps: async (h) => {
      await overrideFieldsByLabel(h, SAMPLE_COMPANY);
      await h.shot("list");
    },
  },
  { id: "mail-settings", title: "メール送信設定", path: "/admin/mail-settings" },
  { id: "r2-explorer", title: "R2ファイル管理", path: "/admin/r2-explorer" },
  {
    id: "announcements",
    title: "システムからのお知らせ管理",
    path: "/admin/announcements",
    steps: async (h) => {
      await h.shot("list");
      await clickTabAndShot(h, /各画面の説明/, "screen-descriptions");
    },
  },
  { id: "progress-stage-owners", title: "進捗確認: 工程ごとの担当設定", path: "/admin/progress-stage-owners" },
  { id: "d1-explorer", title: "D1データ参照・編集", path: "/admin/d1-explorer" },
  { id: "users", title: "ユーザー管理", path: "/admin/users", steps: (h) => listAndNewForm(h) },
  { id: "permissions", title: "画面・権限マスタ", path: "/admin/permissions" },
  { id: "departments", title: "組織・部署マスタ", path: "/admin/departments", steps: (h) => listAndNewForm(h) },
  { id: "roles", title: "役職・ロールマスタ", path: "/admin/roles", steps: (h) => listAndNewForm(h) },
  {
    id: "approval-flows",
    title: "承認フロー定義",
    path: "/admin/approval-flows",
    steps: async (h) => {
      await listAndNewForm(h);
      await h.page.goto(h.page.url());
      await h.settle();
      await openNewForm(h, { button: /申請経路プレビュー/, name: "route-preview" });
    },
  },
  { id: "tax-categories", title: "消費税マスタ", path: "/admin/tax-categories", steps: (h) => listAndNewForm(h) },
];
